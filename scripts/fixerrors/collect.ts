import { resolve } from "node:path";
import { acknowledgeSnapshotIssues } from "./acknowledge";
import { resolveActorAdminId } from "./resolve";
import { fetchOpenIssueSnapshot, writeAndVerifySnapshot, writeAndVerifyTextArtifactAtomic } from "./snapshot";
import type { PgClientLike } from "./types";

/** Collect first, then acknowledge only the unchanged identities we actually read. */
export async function collectAndAcknowledgeIssues(client: PgClientLike, databaseTargetFingerprint: string) {
  const collected = await fetchOpenIssueSnapshot(client, databaseTargetFingerprint);
  if (!collected.issues.some(issue => issue.status === "OPEN")) {
    return { snapshot: collected, acknowledged: 0, skipped: 0 };
  }
  const actorAdminId = await resolveActorAdminId(client);
  const archive = resolve(process.cwd(), "private", "fixerrors", "acknowledgements", collected.snapshotId);
  // Preserve the exact mutation input before touching statuses, even if later analysis fails.
  const verified = writeAndVerifySnapshot(collected, `${archive}.json`);
  const result = await acknowledgeSnapshotIssues({ client, snapshot: verified,
    databaseTargetFingerprint, actorAdminId, apply: true });
  writeAndVerifyTextArtifactAtomic(`${archive}-result.json`, `${JSON.stringify(result, null, 2)}\n`);
  // Fresh reads keep the report/checksums honest and expose concurrent new or changed issues.
  // Do not loop indefinitely acknowledging activity that arrived after the initial collection.
  const snapshot = await fetchOpenIssueSnapshot(client, databaseTargetFingerprint);
  return { snapshot, acknowledged: result.results.filter(item => item.decision === "acknowledged").length,
    skipped: result.results.filter(item => item.decision === "skipped-stale" || item.decision === "skipped-missing").length };
}
