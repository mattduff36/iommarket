import { randomUUID } from "node:crypto";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import { identityUnchanged, selectIssuesForUpdate } from "./live-issues";
import { sanitizeNextStep } from "./notes";
import { assertSnapshotTarget, verifySnapshot } from "./snapshot";
import type { OpenIssueSnapshot, PgClientLike } from "./types";

/** Undo only unchanged mutes made by the specified audited run, never resolve. */
export async function reopenMutedByRun(input: {
  client: PgClientLike;
  snapshot: OpenIssueSnapshot;
  databaseTargetFingerprint: string;
  runId: string;
  issueIds: string[];
  evidence: string;
  actorAdminId: string;
  apply: boolean;
  now?: Date;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.runId)) {
    throw new Error("A valid mute run UUID is required");
  }
  verifySnapshot(input.snapshot);
  // A correction may happen after export expiry; immutable identity and the
  // latest audit event bind it to the original action instead of a time window.
  assertSnapshotTarget(input.snapshot, input.databaseTargetFingerprint);
  const ids = [...new Set(input.issueIds)];
  if (!ids.length || ids.length !== input.issueIds.length || ids.length > 50) {
    throw new Error("Specify between 1 and 50 distinct issue IDs");
  }
  const originals = new Map(input.snapshot.issues.map((issue) => [issue.id, issue]));
  if (ids.some((id) => !originals.has(id))) throw new Error("Issue is absent from verified snapshot");
  const evidence = sanitizeNextStep(input.evidence);
  const now = input.now ?? new Date();
  const correctionRunId = randomUUID();
  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const live = await selectIssuesForUpdate(input.client, ids);
    for (const id of ids) {
      const issue = live.get(id);
      if (!issue || issue.status !== "MUTED" || !identityUnchanged(originals.get(id)!, issue)) {
        throw new Error(`Mute correction blocked: ${id} changed or is no longer muted`);
      }
      const audit = await input.client.query<{ action: string; details: { runId?: string; snapshotId?: string; nextStep?: string }; createdAt: Date }>(
        `SELECT action, details, "createdAt" FROM "AdminAuditLog"
         WHERE "entityType" = 'MonitoringIssue' AND "entityId" = $1
         ORDER BY "createdAt" DESC, id DESC LIMIT 1`, [id],
      );
      const last = audit.rows[0];
      const event = await input.client.query<{ toStatus: string; createdAt: Date; notes: string }>(
        `SELECT "toStatus", "createdAt", notes FROM "MonitoringIssueStatusEvent"
         WHERE "issueId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 1`, [id],
      );
      if (last?.action !== "FIXERRORS_MUTE_MONITORING_ISSUE"
        || last.details?.runId !== input.runId || last.details?.snapshotId !== input.snapshot.snapshotId
        || event.rows[0]?.toStatus !== "MUTED"
        || typeof last.details.nextStep !== "string" || event.rows[0].notes !== last.details.nextStep
        || new Date(event.rows[0].createdAt).getTime() !== new Date(last.createdAt).getTime()) {
        throw new Error(`Mute correction blocked: ${id} has a different or newer status action`);
      }
    }
    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { applied: false, correctionRunId, issueIds: ids, outcome: "would-acknowledge" };
    }
    for (const id of ids) {
      const result = await input.client.query(
        `UPDATE "MonitoringIssue" SET status = 'ACKNOWLEDGED', "mutedUntil" = NULL,
         "resolvedAt" = NULL, "acknowledgedAt" = $2, "acknowledgedSeverity" = severity, "updatedAt" = $2
         WHERE id = $1 AND status = 'MUTED' AND fingerprint = $3`,
        [id, now, originals.get(id)!.fingerprint],
      );
      if (result.rowCount !== 1) throw new Error("Mute correction changed concurrently; rolling back");
      await insertStatusEvent(input.client, { issueId: id, fromStatus: "MUTED", toStatus: "ACKNOWLEDGED", notes: evidence, now });
      await insertAdminAudit(input.client, {
        adminId: input.actorAdminId, action: "FIXERRORS_CORRECT_MUTE", issueId: id,
        details: { runId: correctionRunId, reversesRunId: input.runId, snapshotId: input.snapshot.snapshotId, evidence }, now,
      });
    }
    await input.client.query("COMMIT");
    return { applied: true, correctionRunId, issueIds: ids, outcome: "acknowledged" };
  } catch (error) {
    await input.client.query("ROLLBACK");
    throw error;
  }
}
