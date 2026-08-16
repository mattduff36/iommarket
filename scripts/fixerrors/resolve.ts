import { randomUUID } from "node:crypto";
import {
  FIXERRORS_SAFETY_CONTRACT,
  type OpenIssueSnapshot,
  type PgClientLike,
  type ResolveIssueResult,
  type ResolveRunResult,
  type SnapshotIssue,
} from "./types";
import { assertSnapshotUsable } from "./snapshot";

function newId(): string {
  return `c${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function sameInstant(left: string, right: unknown): boolean {
  if (typeof right === "string") return left === right;
  const rightDate = right instanceof Date ? right : new Date(String(right));
  return new Date(left).toISOString() === rightDate.toISOString();
}

export function decideIssueResolution(
  snapshotIssue: SnapshotIssue | undefined,
  live: {
    id: string;
    fingerprint: string;
    status: string;
    lastSeenAt: unknown;
    occurrences: number;
  } | undefined,
  reportOnlyIssueIds: Set<string>,
): ResolveIssueResult {
  if (!snapshotIssue) {
    return { issueId: live?.id ?? "unknown", decision: "skipped-missing", reason: "Issue was not in the snapshot" };
  }
  if (reportOnlyIssueIds.has(snapshotIssue.id)) {
    return { issueId: snapshotIssue.id, decision: "report-only", reason: "No evidenced code defect" };
  }
  if (!live) {
    return { issueId: snapshotIssue.id, decision: "skipped-missing", reason: "Issue no longer exists" };
  }
  if (live.status !== "OPEN") {
    return { issueId: snapshotIssue.id, decision: "skipped-not-open", reason: `Status is ${live.status}` };
  }
  if (
    live.fingerprint !== snapshotIssue.fingerprint ||
    live.occurrences !== snapshotIssue.occurrences ||
    !sameInstant(snapshotIssue.lastSeenAt, live.lastSeenAt)
  ) {
    return {
      issueId: snapshotIssue.id,
      decision: "skipped-stale",
      reason: "fingerprint, lastSeenAt, or occurrences changed after export",
    };
  }
  return { issueId: snapshotIssue.id, decision: "would-resolve", reason: "Unchanged OPEN issue" };
}

export async function resolveSnapshotIssues(input: {
  client: PgClientLike;
  snapshot: OpenIssueSnapshot;
  issueIds: string[];
  evidence: string;
  apply: boolean;
  databaseTargetFingerprint: string;
  actorAdminId: string;
  now?: Date;
}): Promise<ResolveRunResult> {
  const now = input.now ?? new Date();
  assertSnapshotUsable(input.snapshot, input.databaseTargetFingerprint, now);
  if (input.snapshot.safetyContract !== FIXERRORS_SAFETY_CONTRACT) {
    throw new Error("Safety contract mismatch");
  }
  if (!input.evidence.trim()) {
    throw new Error("Resolution requires per-issue evidence of a code fix");
  }

  const runId = randomUUID();
  const requested = [...new Set(input.issueIds)];
  const snapshotById = new Map(input.snapshot.issues.map((issue) => [issue.id, issue]));
  const reportOnly = new Set(input.snapshot.analysis.reportOnlyIssueIds);

  if (requested.length === 0) {
    return { runId, applied: false, results: [] };
  }

  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const liveResult = await input.client.query<{
      id: string;
      fingerprint: string;
      status: string;
      lastSeenAt: Date | string;
      occurrences: number;
    }>(
      `SELECT id, fingerprint, status,
              to_char("lastSeenAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lastSeenAt",
              occurrences
       FROM "MonitoringIssue"
       WHERE id = ANY($1::text[])
       FOR UPDATE`,
      [requested],
    );
    const liveById = new Map(liveResult.rows.map((row) => [row.id, row]));
    const results = requested.map((issueId) =>
      decideIssueResolution(snapshotById.get(issueId), liveById.get(issueId), reportOnly),
    );

    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { runId, applied: false, results };
    }

    const resolvable = results.filter((result) => result.decision === "would-resolve");
    for (const result of resolvable) {
      const snapshotIssue = snapshotById.get(result.issueId)!;
      const update = await input.client.query(
        `UPDATE "MonitoringIssue"
         SET status = 'RESOLVED',
             "resolvedAt" = $2,
             "mutedUntil" = NULL,
             "updatedAt" = $2
         WHERE id = $1
           AND status = 'OPEN'
           AND fingerprint = $3
           AND occurrences = $4
           AND "lastSeenAt" = $5::timestamptz`,
        [
          result.issueId,
          now,
          snapshotIssue.fingerprint,
          snapshotIssue.occurrences,
          snapshotIssue.lastSeenAt,
        ],
      );
      if ((update.rowCount ?? 0) !== 1) {
        throw new Error(`Failed to resolve ${result.issueId}; transaction rolled back`);
      }
      await input.client.query(
        `INSERT INTO "MonitoringIssueStatusEvent"
          (id, "issueId", "fromStatus", "toStatus", "changedByUserId", notes, "createdAt")
         VALUES ($1, $2, 'OPEN', 'RESOLVED', NULL, $3, $4)`,
        [
          newId(),
          result.issueId,
          `fixerrors run=${runId} evidence=${input.evidence}`,
          now,
        ],
      );
      await input.client.query(
        `INSERT INTO "AdminAuditLog"
          (id, "adminId", action, "entityType", "entityId", details, "createdAt")
         VALUES ($1, $2, 'FIXERRORS_RESOLVE_MONITORING_ISSUE', 'MonitoringIssue', $3, $4::jsonb, $5)`,
        [
          newId(),
          input.actorAdminId,
          result.issueId,
          JSON.stringify({
            runId,
            evidence: input.evidence,
            snapshotId: input.snapshot.snapshotId,
          }),
          now,
        ],
      );
      result.decision = "resolved";
      result.reason = "Resolved from verified snapshot";
    }

    await input.client.query("COMMIT");
    return { runId, applied: true, results };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}

export async function reopenResolvedByRun(input: {
  client: PgClientLike;
  runId: string;
  apply: boolean;
  actorAdminId: string;
  now?: Date;
}): Promise<ResolveRunResult> {
  const now = input.now ?? new Date();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.runId,
    )
  ) {
    throw new Error("A valid UUID run id is required to reopen issues");
  }

  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const events = await input.client.query<{ issueId: string }>(
      `SELECT latest."issueId"
       FROM (
         SELECT DISTINCT ON ("issueId")
                "issueId", "toStatus", notes
         FROM "MonitoringIssueStatusEvent"
         ORDER BY "issueId", "createdAt" DESC, id DESC
       ) AS latest
       WHERE latest."toStatus" = 'RESOLVED'
         AND latest.notes LIKE $1`,
      [`fixerrors run=${input.runId} %`],
    );
    const issueIds = [...new Set(events.rows.map((row) => row.issueId))];
    const results: ResolveIssueResult[] = issueIds.map((issueId) => ({
      issueId,
      decision: input.apply ? "resolved" : "would-resolve",
      reason: input.apply ? "Reopened from fixerrors run" : "Would reopen from fixerrors run",
    }));

    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { runId: input.runId, applied: false, results };
    }

    for (const issueId of issueIds) {
      const update = await input.client.query(
        `UPDATE "MonitoringIssue"
         SET status = 'OPEN', "resolvedAt" = NULL, "updatedAt" = $2
         WHERE id = $1 AND status = 'RESOLVED'`,
        [issueId, now],
      );
      if ((update.rowCount ?? 0) !== 1) continue;
      await input.client.query(
        `INSERT INTO "MonitoringIssueStatusEvent"
          (id, "issueId", "fromStatus", "toStatus", "changedByUserId", notes, "createdAt")
         VALUES ($1, $2, 'RESOLVED', 'OPEN', NULL, $3, $4)`,
        [
          newId(),
          issueId,
          `fixerrors reopen run=${input.runId}`,
          now,
        ],
      );
      await input.client.query(
        `INSERT INTO "AdminAuditLog"
          (id, "adminId", action, "entityType", "entityId", details, "createdAt")
         VALUES ($1, $2, 'FIXERRORS_REOPEN_MONITORING_ISSUE', 'MonitoringIssue', $3, $4::jsonb, $5)`,
        [
          newId(),
          input.actorAdminId,
          issueId,
          JSON.stringify({ runId: input.runId }),
          now,
        ],
      );
    }

    await input.client.query("COMMIT");
    return { runId: input.runId, applied: true, results };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}

export async function resolveActorAdminId(
  client: PgClientLike,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const configured = env.FIXERRORS_ACTOR_ADMIN_ID?.trim();
  if (configured) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE id = $1 AND role = 'ADMIN' AND "deletedAt" IS NULL LIMIT 1`,
      [configured],
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }
  const fallback = await client.query<{ id: string }>(
    `SELECT id FROM "User" WHERE role = 'ADMIN' AND "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1`,
  );
  if (fallback.rows[0]?.id) return fallback.rows[0].id;
  throw new Error("No ADMIN user is available to audit automatic monitoring resolution");
}
