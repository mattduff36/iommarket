import { randomUUID } from "node:crypto";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import { identityUnchanged, selectIssuesForUpdate, type LiveMonitoringIssue } from "./live-issues";
import { resolutionNote, sanitizeEvidence } from "./notes";
import { assertSnapshotUsable } from "./snapshot";
import {
  FIXERRORS_SAFETY_CONTRACT,
  type OpenIssueSnapshot,
  type PgClientLike,
  type ResolveIssueResult,
  type ResolveRunResult,
  type SnapshotIssue,
} from "./types";

export function decideIssueResolution(
  snapshotIssue: SnapshotIssue | undefined,
  live: {
    id: string;
    fingerprint: string;
    status: string;
    lastSeenAt: unknown;
    occurrences: number;
  } | undefined,
): ResolveIssueResult {
  if (!snapshotIssue) {
    return { issueId: live?.id ?? "unknown", decision: "skipped-missing", reason: "Issue was not in the snapshot" };
  }
  if (!live) {
    return { issueId: snapshotIssue.id, decision: "skipped-missing", reason: "Issue no longer exists" };
  }
  if (live.status !== "OPEN" && live.status !== "ACKNOWLEDGED") {
    return { issueId: snapshotIssue.id, decision: "skipped-not-open", reason: `Status is ${live.status}` };
  }
  if (!identityUnchanged(snapshotIssue, live)) {
    return {
      issueId: snapshotIssue.id,
      decision: "skipped-stale",
      reason: "fingerprint, lastSeenAt, or occurrences changed after export",
    };
  }
  return { issueId: snapshotIssue.id, decision: "would-resolve", reason: "Unchanged OPEN or ACKNOWLEDGED issue" };
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
  const evidence = sanitizeEvidence(input.evidence);

  const runId = randomUUID();
  const requested = [...new Set(input.issueIds)];
  const snapshotById = new Map(input.snapshot.issues.map((issue) => [issue.id, issue]));
  if (requested.length === 0) return { runId, applied: false, results: [] };

  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const liveById = await selectIssuesForUpdate(input.client, requested);
    const results = requested.map((issueId) =>
      decideIssueResolution(snapshotById.get(issueId), liveById.get(issueId)),
    );
    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { runId, applied: false, results };
    }

    for (const result of results.filter((entry) => entry.decision === "would-resolve")) {
      await applyResolution({
        client: input.client,
        snapshotIssue: snapshotById.get(result.issueId)!,
        live: liveById.get(result.issueId)!,
        evidence,
        actorAdminId: input.actorAdminId,
        runId,
        snapshotId: input.snapshot.snapshotId,
        now,
      });
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

async function applyResolution(input: {
  client: PgClientLike;
  snapshotIssue: SnapshotIssue;
  live: LiveMonitoringIssue;
  evidence: string;
  actorAdminId: string;
  runId: string;
  snapshotId: string;
  now: Date;
}): Promise<void> {
  const update = await input.client.query(
    `UPDATE "MonitoringIssue"
     SET status = 'RESOLVED',
         "resolvedAt" = $2,
         "mutedUntil" = NULL,
         "acknowledgedAt" = NULL,
         "acknowledgedSeverity" = NULL,
         "updatedAt" = $2
     WHERE id = $1
       AND status IN ('OPEN', 'ACKNOWLEDGED')
       AND fingerprint = $3
       AND occurrences = $4
       AND "lastSeenAt" = $5::timestamptz`,
    [
      input.snapshotIssue.id,
      input.now,
      input.snapshotIssue.fingerprint,
      input.snapshotIssue.occurrences,
      input.snapshotIssue.lastSeenAt,
    ],
  );
  if ((update.rowCount ?? 0) !== 1) {
    throw new Error(`Failed to resolve ${input.snapshotIssue.id}; transaction rolled back`);
  }
  await insertStatusEvent(input.client, {
    issueId: input.snapshotIssue.id,
    fromStatus: input.live.status,
    toStatus: "RESOLVED",
    notes: resolutionNote(input.runId, input.evidence),
    now: input.now,
  });
  await insertAdminAudit(input.client, {
    adminId: input.actorAdminId,
    action: "FIXERRORS_RESOLVE_MONITORING_ISSUE",
    issueId: input.snapshotIssue.id,
    details: {
      runId: input.runId,
      evidence: input.evidence,
      snapshotId: input.snapshotId,
    },
    now: input.now,
  });
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
      await reopenIssue(input.client, issueId, input.runId, input.actorAdminId, now);
    }
    await input.client.query("COMMIT");
    return { runId: input.runId, applied: true, results };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}

async function reopenIssue(
  client: PgClientLike,
  issueId: string,
  runId: string,
  actorAdminId: string,
  now: Date,
): Promise<void> {
  const update = await client.query(
    `UPDATE "MonitoringIssue"
     SET status = 'OPEN', "resolvedAt" = NULL, "updatedAt" = $2
     WHERE id = $1 AND status = 'RESOLVED'`,
    [issueId, now],
  );
  if ((update.rowCount ?? 0) !== 1) return;
  await insertStatusEvent(client, {
    issueId,
    fromStatus: "RESOLVED",
    toStatus: "OPEN",
    notes: `fixerrors reopen run=${runId}`,
    now,
  });
  await insertAdminAudit(client, {
    adminId: actorAdminId,
    action: "FIXERRORS_REOPEN_MONITORING_ISSUE",
    issueId,
    details: { runId },
    now,
  });
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
