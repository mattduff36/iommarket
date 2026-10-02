export interface VercelAcquisition {
  available: boolean;
  visitors?: number;
  pageviews?: number;
  events: Array<{ name: string; count: number }>;
  devices: Array<{ name: string; count: number }>;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function groupedRows(data: unknown, labelKey: string): Array<{ name: string; count: number }> {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const name = record[labelKey];
    if (typeof name !== "string" || name.length === 0) return [];
    return [{ name, count: asCount(record.count) }];
  });
}

async function vercelGet(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Vercel analytics returned ${response.status}`);
  return response.json();
}

export async function loadVercelAcquisition(input: {
  since: Date;
  until?: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
} = { since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }): Promise<VercelAcquisition> {
  const env = input.env ?? process.env;
  const token = env.VERCEL_ACCESS_TOKEN || env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_ORG_ID || env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) {
    return { available: false, events: [], devices: [] };
  }

  const until = input.until ?? new Date();
  const shared = new URLSearchParams({
    projectId,
    teamId,
    since: input.since.toISOString(),
    until: until.toISOString(),
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const [visits, events, devices] = await Promise.all([
      vercelGet(`/v1/query/web-analytics/visits/count?${shared}`, token, fetchImpl),
      vercelGet(`/v1/query/web-analytics/events/aggregate?${shared}&by=eventName`, token, fetchImpl),
      vercelGet(`/v1/query/web-analytics/visits/aggregate?${shared}&by=deviceType`, token, fetchImpl),
    ]);
    const visitData = visits && typeof visits === "object" && "data" in visits
      ? (visits as { data?: { visitors?: unknown; pageviews?: unknown } }).data
      : undefined;
    const eventData = events && typeof events === "object" && "data" in events
      ? (events as { data?: unknown }).data
      : undefined;
    const deviceData = devices && typeof devices === "object" && "data" in devices
      ? (devices as { data?: unknown }).data
      : undefined;
    return {
      available: true,
      visitors: asCount(visitData?.visitors),
      pageviews: asCount(visitData?.pageviews),
      events: groupedRows(eventData, "eventName"),
      devices: groupedRows(deviceData, "deviceType"),
    };
  } catch {
    return { available: false, events: [], devices: [] };
  }
}
