import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { investigationSchema, readInvestigation } from "@/lib/monitoring/investigation";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import { canonicalJson, contentChecksum } from "./integrity";
import { identityUnchanged, selectIssuesForUpdate } from "./live-issues";
import { assertSnapshotUsable } from "./snapshot";
import type { OpenIssueSnapshot, PgClientLike } from "./types";

const entrySchema = z.union([
  z.object({ issueId: z.string().min(1), action: z.literal("retain") }).strict(),
  z.object({ issueId: z.string().min(1), action: z.literal("update").optional(), investigation: investigationSchema }).strict(),
]);
const manifestSchema = z.object({ issues: z.array(entrySchema).min(1) }).strict();
type Entry = z.infer<typeof entrySchema>;

function assertCoverage(entries: Entry[], ids: string[]) {
  const actual = entries.map(entry => entry.issueId).sort();
  if (new Set(actual).size !== actual.length || canonicalJson(actual) !== canonicalJson([...ids].sort())) {
    throw new Error("Investigation manifest must cover every snapshot issue exactly once");
  }
}

export function readInvestigationManifest(path: string, ids: string[]) {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  assertCoverage(manifest.issues, ids);
  return manifest.issues;
}

/** Missing plans remain incomplete update entries: never manufacture investigation evidence. */
export function draftInvestigationManifest(snapshot: OpenIssueSnapshot) {
  return { issues: snapshot.issues.map(issue => ({ issueId: issue.id,
    action: readInvestigation(issue.investigation) ? "retain" : "update" })) };
}

export async function recordInvestigations(input: {
  client: PgClientLike; snapshot: OpenIssueSnapshot; databaseTargetFingerprint: string;
  actorAdminId: string; entries: Entry[]; apply: boolean; now?: Date; cwd?: string;
  verifyCollector: (sha: string, paths: string[]) => Promise<boolean>;
}) {
  const now = input.now ?? new Date();
  assertSnapshotUsable(input.snapshot, input.databaseTargetFingerprint, now);
  const entries = manifestSchema.parse({ issues: input.entries }).issues;
  assertCoverage(entries, input.snapshot.issues.map(issue => issue.id));
  const issues = new Map(input.snapshot.issues.map(issue => [issue.id, issue]));
  const verified = new Map<string, Promise<void>>();
  for (const entry of entries) {
    const issue = issues.get(entry.issueId)!;
    if (entry.action === "retain") {
      if (!readInvestigation(issue.investigation)) throw new Error(`Cannot retain missing or invalid investigation: ${entry.issueId}`);
      continue;
    }
    const record = entry.investigation;
    if (Date.parse(record.reviewAfter) <= now.getTime()) throw new Error("Investigation review date must be in the future");
    const key = canonicalJson(record.collector);
    if (!verified.has(key)) {
      verified.set(key, (async () => {
        const paths = [...new Set([...record.collector.paths, ...record.collector.tests])].sort();
        for (const file of paths) {
          if (!existsSync(resolve(input.cwd ?? process.cwd(), file))) throw new Error(`Collector evidence file does not exist: ${file}`);
        }
        if (record.collector.state === "deployed" && (!record.collector.deploymentSha
          || !await input.verifyCollector(record.collector.deploymentSha, paths))) throw new Error("Collector deployment could not be verified");
      })());
    }
    await verified.get(key);
    if (record.outcome === "expired" && now.getTime() - Date.parse(issue.lastSeenAt) < 14 * 86_400_000) {
      throw new Error("Recent issues cannot be expired as historical evidence gaps");
    }
  }
  const runId = randomUUID();
  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const live = await selectIssuesForUpdate(input.client, entries.map(entry => entry.issueId));
    const results = entries.map(entry => {
      const issue = issues.get(entry.issueId)!;
      const current = live.get(issue.id);
      if (!current || !["OPEN", "ACKNOWLEDGED"].includes(current.status) || !identityUnchanged(issue, current)
        || current.severity !== issue.severity) throw new Error(`Issue changed since export: ${issue.id}; no investigation was applied`);
      const expected = issue.investigationChecksum ?? contentChecksum(issue.investigation);
      if (expected !== contentChecksum(current.investigation)) throw new Error(`Investigation changed since export: ${issue.id}; no investigation was applied`);
      const outcome = entry.action === "retain" ? readInvestigation(issue.investigation)!.outcome : entry.investigation.outcome;
      return { issueId: issue.id, action: entry.action ?? "update", fromStatus: current.status,
        status: entry.action === "retain" ? current.status : outcome === "expired" ? "EXPIRED" : "ACKNOWLEDGED", outcome };
    });
    if (!input.apply) { await input.client.query("ROLLBACK"); return { runId, applied: false, results }; }
    for (const [index, entry] of entries.entries()) {
      if (entry.action === "retain") continue;
      const issue = issues.get(entry.issueId)!;
      const result = results[index]!;
      const investigation = { ...entry.investigation, observedLastSeenAt: issue.lastSeenAt,
        observedOccurrences: issue.occurrences, recordedAt: now.toISOString(), runId, evidenceBundle: issue.events.slice(0, 3) };
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
