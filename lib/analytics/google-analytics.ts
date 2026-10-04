import { createSign } from "node:crypto";
import { inclusiveDaySpan, londonDate, shiftIsoDate } from "@/lib/analytics/london-date";

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REPORT_URL = "https://analyticsdata.googleapis.com/v1beta/properties";

export interface GoogleAnalyticsSeriesPoint {
  date: string;
  users: number;
  pageviews: number;
}

export interface GoogleAnalyticsCity {
  city: string;
  country: string;
  count: number;
}

export interface GoogleAnalyticsReport {
  status: "available" | "no-data" | "not-configured" | "error";
  users: number;
  pageviews: number;
  previousUsers: number;
  previousPageviews: number;
  series: GoogleAnalyticsSeriesPoint[];
  events: Array<{ name: string; count: number }>;
  devices: Array<{ name: string; count: number }>;
  channels: Array<{ name: string; count: number }>;
  countries: Array<{ name: string; count: number }>;
  cities: GoogleAnalyticsCity[];
}

type GoogleEnv = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type GoogleConfig = { propertyId: string; email: string; privateKey: string };
type DateRange = { startDate: string; endDate: string };
type MetricName = "totalUsers" | "screenPageViews" | "eventCount";
type ReportRequest = {
  dateRanges: DateRange[];
  dimensions?: Array<{ name: string }>;
  metrics: Array<{ name: MetricName }>;
  limit?: string;
  orderBys?: Array<Record<string, unknown>>;
};

interface ParsedRow {
  dimensions: string[];
  metrics: number[];
}

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

function asCount(value: unknown): number {
  const count = typeof value === "string" ? Number(value) : value;
  return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : 0;
}

function emptyReport(status: GoogleAnalyticsReport["status"]): GoogleAnalyticsReport {
  return {
    status,
    users: 0,
    pageviews: 0,
    previousUsers: 0,
    previousPageviews: 0,
    series: [],
    events: [],
    devices: [],
    channels: [],
    countries: [],
    cities: [],
  };
}

function previousRange(current: DateRange): DateRange {
  const span = inclusiveDaySpan(current.startDate, current.endDate);
  return {
    startDate: shiftIsoDate(current.startDate, -span),
    endDate: shiftIsoDate(current.startDate, -1),
  };
}

function metricOrder(metricName: MetricName): Array<Record<string, unknown>> {
  return [{ metric: { metricName }, desc: true }];
}

function reportRequests(current: DateRange): ReportRequest[] {
  const previous = previousRange(current);
  const usersAndViews: Array<{ name: MetricName }> = [{ name: "totalUsers" }, { name: "screenPageViews" }];
  return [
    { dateRanges: [current], metrics: usersAndViews },
    { dateRanges: [previous], metrics: usersAndViews },
    {
      dateRanges: [current],
      dimensions: [{ name: "date" }],
      metrics: usersAndViews,
      limit: "120",
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
    { dateRanges: [current], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "totalUsers" }], limit: "20" },
    {
      dateRanges: [current],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "totalUsers" }],
      limit: "20",
      orderBys: metricOrder("totalUsers"),
    },
    {
      dateRanges: [current],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "totalUsers" }],
      limit: "20",
      orderBys: metricOrder("totalUsers"),
    },
    {
      dateRanges: [current],
      dimensions: [{ name: "city" }, { name: "country" }],
      metrics: [{ name: "totalUsers" }],
      limit: "50",
      orderBys: metricOrder("totalUsers"),
    },
    { dateRanges: [current], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: "100" },
  ];
}

function reportRows(report: unknown): unknown[] {
  if (!report || typeof report !== "object" || !("rows" in report)) return [];
  const rows = (report as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

function parseRow(value: unknown): ParsedRow {
  if (!value || typeof value !== "object") return { dimensions: [], metrics: [] };
  const dimensions = (value as { dimensionValues?: unknown }).dimensionValues;
  const metrics = (value as { metricValues?: unknown }).metricValues;
  return {
    dimensions: Array.isArray(dimensions)
      ? dimensions.map((item) => (
        item && typeof item === "object" && typeof (item as { value?: unknown }).value === "string"
          ? (item as { value: string }).value
          : ""
      ))
      : [],
    metrics: Array.isArray(metrics)
      ? metrics.map((item) => asCount(item && typeof item === "object" ? (item as { value?: unknown }).value : 0))
      : [],
  };
}

function namedCounts(rows: ParsedRow[], dimensionIndex = 0, metricIndex = 0) {
  return rows.flatMap((row) => {
    const name = row.dimensions[dimensionIndex] ?? "";
    if (!name || name === "(not set)") return [];
    return [{ name, count: row.metrics[metricIndex] ?? 0 }];
  });
}

function formatGaDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
}

function seriesFrom(rows: ParsedRow[]): GoogleAnalyticsSeriesPoint[] {
  return rows.flatMap((row) => {
    const date = formatGaDate(row.dimensions[0] ?? "");
    return date ? [{ date, users: row.metrics[0] ?? 0, pageviews: row.metrics[1] ?? 0 }] : [];
  });
}

function citiesFrom(rows: ParsedRow[]): GoogleAnalyticsCity[] {
  return rows.flatMap((row) => {
    const city = row.dimensions[0] ?? "";
    const country = row.dimensions[1] ?? "";
    if (!city || city === "(not set)" || !country || country === "(not set)") return [];
    return [{ city, country, count: row.metrics[0] ?? 0 }];
  });
}

function totalsFrom(rows: ParsedRow[]): { users: number; pageviews: number } {
  const first = rows[0];
  return { users: first?.metrics[0] ?? 0, pageviews: first?.metrics[1] ?? 0 };
}

async function accessToken(config: GoogleConfig, fetchImpl: Fetcher, now: Date): Promise<string | null> {
  const assertion = signedAssertion(config, Math.floor(now.getTime() / 1000));
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
  if (!tokenResponse.ok) return null;
  const tokenBody = await tokenResponse.json() as { access_token?: unknown };
  return typeof tokenBody.access_token === "string" && tokenBody.access_token ? tokenBody.access_token : null;
}

async function runBatch(
  config: GoogleConfig,
  fetchImpl: Fetcher,
  token: string,
  requests: ReportRequest[],
): Promise<unknown[] | null> {
  const reportResponse = await fetchImpl(`${REPORT_URL}/${config.propertyId}:batchRunReports`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!reportResponse.ok) return null;
  const payload = await reportResponse.json() as { reports?: unknown };
  const reports = Array.isArray(payload.reports) ? payload.reports : null;
  return reports && reports.length >= requests.length ? reports : null;
}

function reportFrom(batches: unknown[][]): GoogleAnalyticsReport {
  const rows = batches.flat().map((report) => reportRows(report).map(parseRow));
  if (rows.length < 8) return emptyReport("error");
  const current = totalsFrom(rows[0] ?? []);
  const previous = totalsFrom(rows[1] ?? []);
  return {
    status: rows.every((reportRowsValue) => reportRowsValue.length === 0) ? "no-data" : "available",
    users: current.users,
    pageviews: current.pageviews,
    previousUsers: previous.users,
    previousPageviews: previous.pageviews,
    series: seriesFrom(rows[2] ?? []),
    devices: namedCounts(rows[3] ?? []),
    channels: namedCounts(rows[4] ?? []),
    countries: namedCounts(rows[5] ?? []),
    cities: citiesFrom(rows[6] ?? []),
    events: namedCounts(rows[7] ?? []),
  };
}

export async function loadGoogleAnalytics(input: {
  since: Date;
  until?: Date;
  env?: GoogleEnv;
  fetchImpl?: Fetcher;
  now?: Date;
}): Promise<GoogleAnalyticsReport> {
  const config = readConfig(input.env ?? process.env);
  if (!config) return emptyReport("not-configured");

  const fetchImpl = input.fetchImpl ?? fetch;
  const until = input.until ?? new Date();
  try {
    const token = await accessToken(config, fetchImpl, input.now ?? new Date());
    if (!token) return emptyReport("error");
    const requests = reportRequests({
      startDate: londonDate(input.since),
      endDate: londonDate(until),
    });
    const [first, second] = await Promise.all([
      runBatch(config, fetchImpl, token, requests.slice(0, 5)),
      runBatch(config, fetchImpl, token, requests.slice(5)),
    ]);
    if (!first || !second) return emptyReport("error");
    return reportFrom([first, second]);
  } catch {
    return emptyReport("error");
  }
}
