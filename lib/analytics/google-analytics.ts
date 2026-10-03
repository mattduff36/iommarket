import { createSign } from "node:crypto";

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REPORT_URL = "https://analyticsdata.googleapis.com/v1beta/properties";

export interface GoogleAnalyticsReport {
  status: "available" | "no-data" | "not-configured" | "error";
  users: number;
  pageviews: number;
  events: Array<{ name: string; count: number }>;
  devices: Array<{ name: string; count: number }>;
}

type GoogleEnv = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type GoogleConfig = { propertyId: string; email: string; privateKey: string };

function readConfig(env: GoogleEnv): GoogleConfig | null {
  const propertyId = env.GA4_PROPERTY_ID?.trim() ?? "";
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
  const privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim() ?? "";
  if (!/^\d{4,20}$/.test(propertyId) || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(email)) return null;
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----") || !privateKey.includes("-----END PRIVATE KEY-----")) return null;
  return { propertyId, email, privateKey };
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signedAssertion(config: GoogleConfig, nowSeconds: number): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64Url(JSON.stringify({
    iss: config.email,
    scope: ANALYTICS_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(config.privateKey).toString("base64url")}`;
}

function localDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function asCount(value: unknown): number {
  const count = typeof value === "string" ? Number(value) : value;
  return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : 0;
}

function rowValues(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("dimensionValues" in value) || !("metricValues" in value)) return [];
  const dimensions = (value as { dimensionValues?: unknown }).dimensionValues;
  const metrics = (value as { metricValues?: unknown }).metricValues;
  if (!Array.isArray(dimensions) || !Array.isArray(metrics)) return [];
  const dimension = dimensions[0] as { value?: unknown } | undefined;
  const metric = metrics[0] as { value?: unknown } | undefined;
  return [typeof dimension?.value === "string" ? dimension.value : "", String(metric?.value ?? "0")];
}

function failure(status: GoogleAnalyticsReport["status"]): GoogleAnalyticsReport {
  return { status, users: 0, pageviews: 0, events: [], devices: [] };
}

export async function loadGoogleAnalytics(input: {
  since: Date;
  until?: Date;
  env?: GoogleEnv;
  fetchImpl?: Fetcher;
  now?: Date;
}): Promise<GoogleAnalyticsReport> {
  const config = readConfig(input.env ?? process.env);
  if (!config) return failure("not-configured");

  const fetchImpl = input.fetchImpl ?? fetch;
  const until = input.until ?? new Date();
  try {
    const assertion = signedAssertion(config, Math.floor((input.now ?? new Date()).getTime() / 1000));
    const tokenResponse = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return failure("error");
    const tokenBody = await tokenResponse.json() as { access_token?: unknown };
    if (typeof tokenBody.access_token !== "string" || !tokenBody.access_token) return failure("error");

    const reportResponse = await fetchImpl(`${REPORT_URL}/${config.propertyId}:batchRunReports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests: [
        { dateRanges: [{ startDate: localDate(input.since), endDate: localDate(until) }], metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }] },
        { dateRanges: [{ startDate: localDate(input.since), endDate: localDate(until) }], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: "100" },
        { dateRanges: [{ startDate: localDate(input.since), endDate: localDate(until) }], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "totalUsers" }], limit: "20" },
      ] }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!reportResponse.ok) return failure("error");
    const payload = await reportResponse.json() as { reports?: unknown };
    const reports = Array.isArray(payload.reports) ? payload.reports : [];
    if (reports.length < 3) return failure("error");
    const rows = reports.map((report) => {
      if (!report || typeof report !== "object" || !("rows" in report)) return [];
      const reportRowsValue = (report as { rows?: unknown }).rows;
      return Array.isArray(reportRowsValue) ? reportRowsValue : [];
    });
    const totals = rows[0]?.[0] as { metricValues?: Array<{ value?: unknown }> } | undefined;
    const events = rows[1]!.map(rowValues).filter(([name]) => name).map(([name, count]) => ({ name, count: asCount(count) }));
    const devices = rows[2]!.map(rowValues).filter(([name]) => name).map(([name, count]) => ({ name, count: asCount(count) }));
    const result = {
      status: rows.every((reportRowsValue) => reportRowsValue.length === 0) ? "no-data" as const : "available" as const,
      users: asCount(totals?.metricValues?.[0]?.value),
      pageviews: asCount(totals?.metricValues?.[1]?.value),
      events,
      devices,
    };
    return result;
  } catch {
    return failure("error");
  }
}
