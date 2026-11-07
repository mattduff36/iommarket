import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readReleaseManifest, verifyProductionRelease } from "./release";
import { assertSnapshotTarget, readAndVerifySnapshot } from "./snapshot";
import { appendAlertLog } from "./alert-log";
import type { OpenIssueSnapshot, PgClientLike } from "./types";

export function pendingReleasePaths(cwd = process.cwd()): string[] {
  const root = resolve(cwd, "private", "fixerrors", "runs");
  if (!existsSync(root)) return [];
  const results: string[] = [];
  function visit(path: string, depth: number) {
    const manifest = resolve(path, "release.json");
    if (existsSync(manifest)) results.push(manifest);
    if (depth > 0) for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(resolve(path, entry.name), depth - 1);
    }
  }
  visit(root, 2);
  return results;
}

export async function resumeReleases(input: {
  client: PgClientLike; databaseTargetFingerprint: string; actorAdminId: string; apply: boolean;
}) {
  const results = [];
  for (const path of pendingReleasePaths()) {
    try {
    const manifest = readReleaseManifest(path);
    if (!/^[A-Za-z0-9_-]+$/.test(manifest.snapshotId)) throw new Error("Invalid archived snapshot identifier");
    const snapshot = readAndVerifySnapshot(resolve(process.cwd(), "private", "fixerrors", "snapshots", `${manifest.snapshotId}.json`));
    assertSnapshotTarget(snapshot, input.databaseTargetFingerprint);
    const statuses = await input.client.query('SELECT id, status FROM "MonitoringIssue" WHERE id = ANY($1::text[])', [manifest.issueIds]);
    if (statuses.rows.length === manifest.issueIds.length && statuses.rows.every(row => row.status === "RESOLVED")) {
      results.push({ snapshotId: manifest.snapshotId, clusterId: manifest.clusterId, ok: true, applied: false, completed: true });
      continue;
    }
    const result = await verifyProductionRelease({ ...input, manifest, snapshot });
    recordReleaseRecurrences(snapshot, result);
    results.push({ snapshotId: manifest.snapshotId, clusterId: manifest.clusterId, ...result });
    } catch (error) {
      results.push({ path, ok: false, applied: false, reason: error instanceof Error ? error.message : "Release verification failed" });
    }
  }
  return results;
}

export function recordReleaseRecurrences(snapshot: OpenIssueSnapshot, result: { applied: boolean; recurred: string[] }) {
  if (result.applied && result.recurred.length > 0) {
    const recordedAt = new Date().toISOString();
    appendAlertLog(result.recurred.flatMap((issueId) => {
      const issue = snapshot.issues.find((entry) => entry.id === issueId);
      if (!issue) return [];
      return [{
        at: recordedAt,
        fingerprint: issue.fingerprint,
        normalizedMessage: "",
        source: issue.source,
        route: issue.sampleRoute,
        action: issue.sampleAction,
        severity: issue.severity,
        occurrences: issue.occurrences,
        lastSeenAt: issue.lastSeenAt,
        outcome: "recurred" as const,
        summary: "The error came back after the fix was deployed.",
      }];
    }));
  }
}
