import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { investigationSchema } from "@/lib/monitoring/investigation";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import { identityUnchanged, selectIssuesForUpdate } from "./live-issues";
import { assertSnapshotUsable } from "./snapshot";
import type { OpenIssueSnapshot, PgClientLike } from "./types";

const manifestSchema = z.object({ issues: z.array(z.object({
  issueId: z.string().min(1), investigation: investigationSchema,
}).strict()).min(1) }).strict();

export function readInvestigationManifest(path: string, ids: string[]) {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const actual = manifest.issues.map(entry => entry.issueId).sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify([...ids].sort())) {
    throw new Error("Investigation manifest must cover every snapshot issue exactly once");
  }
  return manifest.issues;
}

export async function recordInvestigations(input: {
  client: PgClientLike; snapshot: OpenIssueSnapshot; databaseTargetFingerprint: string;
  actorAdminId: string; entries: ReturnType<typeof readInvestigationManifest>; apply: boolean;
  now?: Date; cwd?: string;
  verifyCollector: (sha: string, paths: string[]) => Promise<boolean>;
}) {
  const now = input.now ?? new Date();
  assertSnapshotUsable(input.snapshot, input.databaseTargetFingerprint, now);
  const entries = manifestSchema.parse({ issues: input.entries }).issues;
  const ids = entries.map(entry => entry.issueId);
  if (new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify(input.snapshot.issues.map(issue => issue.id).sort())) throw new Error("Incomplete investigation coverage");
  for (const entry of entries) {
    const record = entry.investigation;
    if (Date.parse(record.reviewAfter) <= now.getTime()) throw new Error("Investigation review date must be in the future");
    for (const file of [...record.collector.paths, ...record.collector.tests]) {
      if (!existsSync(resolve(input.cwd ?? process.cwd(), file))) throw new Error(`Collector evidence file does not exist: ${file}`);
    }
    if (record.collector.state === "deployed" && (!record.collector.deploymentSha
      || !await input.verifyCollector(record.collector.deploymentSha, record.collector.paths))) throw new Error("Collector deployment could not be verified");
    const issue = input.snapshot.issues.find(issue => issue.id === entry.issueId)!;
    if (record.outcome === "expired" && now.getTime() - Date.parse(issue.lastSeenAt) < 14 * 86_400_000) {
      throw new Error("Recent issues cannot be expired as historical evidence gaps");
    }
  }
  const runId = randomUUID();
  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const live = await selectIssuesForUpdate(input.client, ids);
    const results = entries.map(entry => {
      const issue = input.snapshot.issues.find(issue => issue.id === entry.issueId)!;
      const current = live.get(issue.id);
      if (!current || !["OPEN", "ACKNOWLEDGED"].includes(current.status) || !identityUnchanged(issue, current)) {
        throw new Error(`Issue changed since export: ${issue.id}; no investigation was applied`);
      }
      return { issueId: issue.id, fromStatus: current.status,
        status: entry.investigation.outcome === "expired" ? "EXPIRED" : "ACKNOWLEDGED", outcome: entry.investigation.outcome };
    });
    if (!input.apply) { await input.client.query("ROLLBACK"); return { runId, applied: false, results }; }
    for (const [index, entry] of entries.entries()) {
      const issue = input.snapshot.issues.find(issue => issue.id === entry.issueId)!;
      const result = results[index]!;
      const investigation = { ...entry.investigation, observedLastSeenAt: issue.lastSeenAt,
        observedOccurrences: issue.occurrences, recordedAt: now.toISOString(), runId,
        evidenceBundle: issue.events.slice(0, 3) };
      const update = await input.client.query(`UPDATE "MonitoringIssue"
        SET status = $2::"MonitoringIssueStatus", investigation = $3::jsonb,
            "acknowledgedAt" = COALESCE("acknowledgedAt", $4), "acknowledgedSeverity" = severity,
            "mutedUntil" = NULL, "resolvedAt" = NULL, "updatedAt" = $4
        WHERE id = $1 AND status IN ('OPEN','ACKNOWLEDGED') AND fingerprint = $5
          AND occurrences = $6 AND "lastSeenAt" = $7::timestamp`,
        [issue.id, result.status, JSON.stringify(investigation), now, issue.fingerprint, issue.occurrences, issue.lastSeenAt]);
      if (update.rowCount !== 1) throw new Error("Concurrent investigation update; rolled back");
      const note = `${entry.investigation.outcome}: ${entry.investigation.finding} Next: ${entry.investigation.nextAction}`.slice(0, 500);
      await insertStatusEvent(input.client, { issueId: issue.id, fromStatus: result.fromStatus, toStatus: result.status, notes: note, now });
      await insertAdminAudit(input.client, { adminId: input.actorAdminId, issueId: issue.id,
        action: "FIXERRORS_RECORD_INVESTIGATION", details: { runId, snapshotId: input.snapshot.snapshotId, investigation }, now });
    }
    await input.client.query("COMMIT");
    return { runId, applied: true, results };
  } catch (error) { await input.client.query("ROLLBACK"); throw error; }
}
