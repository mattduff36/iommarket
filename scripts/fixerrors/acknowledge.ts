import { randomUUID } from "node:crypto";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import {
  identityUnchanged,
  requireMonitoringSeverity,
  selectIssuesForUpdate,
  type LiveMonitoringIssue,
} from "./live-issues";
import { FIXERRORS_INVESTIGATION_NOTE } from "./notes";
import { assertSnapshotUsable } from "./snapshot";
import {
  FIXERRORS_SAFETY_CONTRACT,
  type OpenIssueSnapshot,
  type PgClientLike,
  type ResolveIssueResult,
  type ResolveRunResult,
  type SnapshotIssue,
} from "./types";

export function decideIssueAcknowledgement(
  snapshotIssue: SnapshotIssue | undefined,
  live: LiveMonitoringIssue | undefined,
): ResolveIssueResult {
  if (!snapshotIssue) {
    return { issueId: live?.id ?? "unknown", decision: "skipped-missing", reason: "Issue was not in the snapshot" };
  }
  if (!live) {
    return { issueId: snapshotIssue.id, decision: "skipped-missing", reason: "Issue no longer exists" };
  }
  if (live.status !== "OPEN") {
    return { issueId: snapshotIssue.id, decision: "skipped-not-open", reason: `Status is ${live.status}` };
  }
  if (!identityUnchanged(snapshotIssue, live)) {
    return {
      issueId: snapshotIssue.id,
      decision: "skipped-stale",
      reason: "fingerprint, lastSeenAt, or occurrences changed after export",
    };
  }
  return { issueId: snapshotIssue.id, decision: "would-acknowledge", reason: "Unchanged OPEN issue" };
}

export async function acknowledgeSnapshotIssues(input: {
  client: PgClientLike;
  snapshot: OpenIssueSnapshot;
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

  const runId = randomUUID();
  const snapshotById = new Map(input.snapshot.issues.map((issue) => [issue.id, issue]));
  if (input.snapshot.issues.length === 0) {
    return { runId, applied: false, results: [] };
  }

  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const liveById = await selectIssuesForUpdate(
      input.client,
      input.snapshot.issues.map((issue) => issue.id),
    );
    const results = input.snapshot.issues.map((issue) =>
      decideIssueAcknowledgement(snapshotById.get(issue.id), liveById.get(issue.id)),
    );
    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { runId, applied: false, results };
    }

    for (const result of results) {
      if (result.decision !== "would-acknowledge") continue;
      await applyAcknowledgement({
        client: input.client,
        snapshotIssue: snapshotById.get(result.issueId)!,
        live: liveById.get(result.issueId)!,
        actorAdminId: input.actorAdminId,
        runId,
        snapshotId: input.snapshot.snapshotId,
        now,
      });
      result.decision = "acknowledged";
      result.reason = "Acknowledged from verified snapshot";
    }

    await input.client.query("COMMIT");
    return { runId, applied: true, results };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}

async function applyAcknowledgement(input: {
  client: PgClientLike;
  snapshotIssue: SnapshotIssue;
  live: LiveMonitoringIssue;
  actorAdminId: string;
  runId: string;
  snapshotId: string;
  now: Date;
}): Promise<void> {
  const severity = requireMonitoringSeverity(input.live.severity, input.snapshotIssue.severity);
  const update = await input.client.query(
    `UPDATE "MonitoringIssue"
     SET status = 'ACKNOWLEDGED',
         "acknowledgedAt" = $2,
         "acknowledgedSeverity" = $3::"MonitoringSeverity",
         "mutedUntil" = NULL,
         "resolvedAt" = NULL,
         "updatedAt" = $2
     WHERE id = $1
       AND status = 'OPEN'
       AND fingerprint = $4
       AND occurrences = $5
       AND "lastSeenAt" = $6::timestamptz`,
    [
      input.snapshotIssue.id,
      input.now,
      severity,
      input.snapshotIssue.fingerprint,
      input.snapshotIssue.occurrences,
      input.snapshotIssue.lastSeenAt,
    ],
  );
  if ((update.rowCount ?? 0) !== 1) {
    throw new Error(`Failed to acknowledge ${input.snapshotIssue.id}; transaction rolled back`);
  }
  await insertStatusEvent(input.client, {
    issueId: input.snapshotIssue.id,
    fromStatus: "OPEN",
    toStatus: "ACKNOWLEDGED",
    notes: FIXERRORS_INVESTIGATION_NOTE,
    now: input.now,
  });
  await insertAdminAudit(input.client, {
    adminId: input.actorAdminId,
    action: "FIXERRORS_ACKNOWLEDGE_MONITORING_ISSUE",
    issueId: input.snapshotIssue.id,
    details: { runId: input.runId, snapshotId: input.snapshotId },
    now: input.now,
  });
}
