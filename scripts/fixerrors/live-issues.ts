import type { PgClientLike, SnapshotIssue } from "./types";

const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export type LiveMonitoringIssue = {
  id: string;
  fingerprint: string;
  status: string;
  severity: string;
  lastSeenAt: string;
  occurrences: number;
};

export function sameInstant(left: string, right: unknown): boolean {
  if (typeof right === "string") return left === right;
  const rightDate = right instanceof Date ? right : new Date(String(right));
  return new Date(left).toISOString() === rightDate.toISOString();
}

export function identityUnchanged(
  snapshotIssue: Pick<SnapshotIssue, "fingerprint" | "lastSeenAt" | "occurrences">,
  live: { fingerprint: string; lastSeenAt: unknown; occurrences: number },
): boolean {
  return (
    live.fingerprint === snapshotIssue.fingerprint &&
    live.occurrences === snapshotIssue.occurrences &&
    sameInstant(snapshotIssue.lastSeenAt, live.lastSeenAt)
  );
}

export function requireMonitoringSeverity(value: string | undefined, fallback: string): string {
  if (value && SEVERITIES.has(value)) return value;
  if (SEVERITIES.has(fallback)) return fallback;
  throw new Error("Unsupported monitoring severity");
}

export async function selectIssuesForUpdate(
  client: PgClientLike,
  issueIds: string[],
): Promise<Map<string, LiveMonitoringIssue>> {
  if (issueIds.length === 0) return new Map();
  const liveResult = await client.query<{
    id: string;
    fingerprint: string;
    status: string;
    severity: string;
    lastSeenAt: string;
    occurrences: number | string;
  }>(
    `SELECT id, fingerprint, status, severity,
            to_char("lastSeenAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lastSeenAt",
            occurrences
     FROM "MonitoringIssue"
     WHERE id = ANY($1::text[])
     FOR UPDATE`,
    [issueIds],
  );
  return new Map(
    liveResult.rows.map((row) => [
      row.id,
      {
        id: row.id,
        fingerprint: row.fingerprint,
        status: row.status,
        severity: String(row.severity ?? ""),
        lastSeenAt: String(row.lastSeenAt),
        occurrences: Number(row.occurrences),
      },
    ]),
  );
}
