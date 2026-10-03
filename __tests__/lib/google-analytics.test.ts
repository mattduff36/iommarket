import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadGoogleAnalytics } from "@/lib/analytics/google-analytics";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = {
  GA4_PROPERTY_ID: "123456789",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "analytics-reader@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKeyPem.replace(/\n/g, "\\n"),
};
const range = {
  since: new Date("2026-03-28T23:30:00.000Z"),
  until: new Date("2026-03-29T23:30:00.000Z"),
  now: new Date("2026-10-03T10:00:00.000Z"),
};

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("Google Analytics report loader", () => {
  it("does not call Google if server credentials are missing or malformed", async () => {
    const fetchImpl = vi.fn();
    const report = await loadGoogleAnalytics({ ...range, env: { GA4_PROPERTY_ID: "123" }, fetchImpl });
    expect(report.status).toBe("not-configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a scoped signed JWT and maps the batched GA4 reports", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "test-access-token" }))
      .mockResolvedValueOnce(response({ reports: [
        { rows: [{ metricValues: [{ value: "31" }, { value: "82" }] }] },
        { rows: [
          { dimensionValues: [{ value: "page_view" }], metricValues: [{ value: "82" }] },
          { dimensionValues: [{ value: "search_performed" }], metricValues: [{ value: "4" }] },
        ] },
        { rows: [
          { dimensionValues: [{ value: "mobile" }], metricValues: [{ value: "21" }] },
          { dimensionValues: [{ value: "desktop" }], metricValues: [{ value: "10" }] },
        ] },
      ] }));

    const report = await loadGoogleAnalytics({ ...range, env, fetchImpl, now: range.now });

    expect(report).toEqual({
      status: "available",
      users: 31,
      pageviews: 82,
      events: [{ name: "page_view", count: 82 }, { name: "search_performed", count: 4 }],
      devices: [{ name: "mobile", count: 21 }, { name: "desktop", count: 10 }],
    });
    const tokenCall = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(tokenCall[0]).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(tokenCall[1].body));
    const jwt = form.get("assertion")!.split(".");
    const claims = JSON.parse(Buffer.from(jwt[1]!, "base64url").toString("utf8"));
    expect(claims).toMatchObject({
      iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(range.now.getTime() / 1000),
      exp: Math.floor(range.now.getTime() / 1000) + 3600,
    });
    expect(verify("RSA-SHA256", Buffer.from(`${jwt[0]}.${jwt[1]}`), publicKey, Buffer.from(jwt[2]!, "base64url"))).toBe(true);

    const apiCall = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(apiCall[0]).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports");
    expect((apiCall[1].headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
    const requestBody = JSON.parse(String(apiCall[1].body));
    expect(requestBody.requests).toHaveLength(3);
    expect(requestBody.requests[0].dateRanges).toEqual([{ startDate: "2026-03-28", endDate: "2026-03-30" }]);
    expect(requestBody.requests[0].metrics).toEqual([{ name: "totalUsers" }, { name: "screenPageViews" }]);
    expect(requestBody.requests[1].dimensions).toEqual([{ name: "eventName" }]);
    expect(requestBody.requests[2].dimensions).toEqual([{ name: "deviceCategory" }]);
  });

  it("distinguishes a successful empty period from API errors without exposing provider messages", async () => {
    const noDataFetch = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "test-access-token" }))
      .mockResolvedValueOnce(response({ reports: [{}, {}, {}] }));
    expect((await loadGoogleAnalytics({ ...range, env, fetchImpl: noDataFetch })).status).toBe("no-data");

    const failedFetch = vi.fn().mockResolvedValueOnce(response({ error: { message: "private detail" } }, false));
    const failed = await loadGoogleAnalytics({ ...range, env, fetchImpl: failedFetch });
    expect(failed).toEqual({ status: "error", users: 0, pageviews: 0, events: [], devices: [] });
    expect(JSON.stringify(failed)).not.toContain("private detail");
  });

  it("returns a generic error when the API transport fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("transport detail"));
    expect((await loadGoogleAnalytics({ ...range, env, fetchImpl })).status).toBe("error");
  });
});
