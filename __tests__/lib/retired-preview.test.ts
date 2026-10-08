import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { retiredPreviewResponse } from "@/lib/deployment/retired-preview";

describe("retired preview hostname", () => {
  it.each(["/preview", "/preview/", "/dev", "/dev/auth"])("retires obsolete access URL %s without a login redirect", async (path) => {
    for (const environment of ["production", "preview"]) {
      const response = retiredPreviewResponse(new NextRequest(`https://itrader.im${path}?next=/admin`), { VERCEL_ENV: environment });
      expect(response?.status).toBe(404);
      expect(response?.headers.get("location")).toBeNull();
      expect(await response?.text()).not.toContain('type="password"');
    }
  });
  it.each(["/staging-access", "/sign-in", "/api/dev-auth", "/api/webhooks/ripple"])("preserves current access and payment routes %s", (path) => {
    expect(retiredPreviewResponse(new NextRequest(`https://itrader.dev${path}`), { VERCEL_ENV: "preview" })).toBeNull();
  });
  it.each(["/", "/listings/old", "/robots.txt", "/api/me", "/_next/static/test.js"])("returns a branded true 404 for %s", async (path) => {
    const response = retiredPreviewResponse(new NextRequest(`https://preview.itrader.im${path}`), { VERCEL_ENV: "production" });
    expect(response?.status).toBe(404);
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response?.headers.get("location")).toBeNull();
    expect(await response?.text()).toContain("Visit iTrader.im");
  });
  it("leaves the old signed relay available until its hostname is moved off staging", () => {
    expect(retiredPreviewResponse(new NextRequest("https://preview.itrader.im/api/webhooks/ripple-staging", { method: "POST" }), { VERCEL_ENV: "preview" })).toBeNull();
  });
  it("uses the official production logo and graphite/red branding without requiring old-host assets", async () => {
    const response = retiredPreviewResponse(new NextRequest("https://preview.itrader.im/"), { VERCEL_ENV: "production" });
    const html = await response!.text();
    expect(html).toContain('src="https://itrader.im/images/logo-itrader-hq.png"');
    expect(html).toContain('alt="iTrader.im"');
    expect(html).toContain("height:auto");
    expect(html).toContain("#050505");
    expect(html).toContain("#0A0A0B");
    expect(html).toContain("#FF1F1F");
    expect(html).not.toContain("#54caff");
    expect(html).not.toContain('class="brand">iTrader');
    expect(response!.headers.get("content-security-policy")).toBe("default-src 'none'; img-src https://itrader.im/images/logo-itrader-hq.png; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  });
  it("returns the same true 404 headers and an empty body for HEAD", async () => {
    const response = retiredPreviewResponse(new NextRequest("https://preview.itrader.im/images/logo-itrader-hq.png", { method: "HEAD" }), { VERCEL_ENV: "production" });
    expect(response!.status).toBe(404);
    expect(response!.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response!.text()).toBe("");
  });
  it.each(["itrader.im", "itrader.dev", "staging.itrader.im", "preview.itrader.im.example.com"])("does not retire %s", (host) => {
    expect(retiredPreviewResponse(new NextRequest(`https://${host}/`), { VERCEL_ENV: "production" })).toBeNull();
  });
});
