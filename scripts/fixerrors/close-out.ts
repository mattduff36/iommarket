import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { insertAdminAudit, insertStatusEvent } from "./audit";
import {
  identityUnchanged,
  requireMonitoringSeverity,
  selectIssuesForUpdate,
  type LiveMonitoringIssue,
} from "./live-issues";
import { sanitizeNextStep } from "./notes";
import { assertSnapshotUsable, writeAndVerifyTextArtifactAtomic } from "./snapshot";
import {
  FIXERRORS_SAFETY_CONTRACT,
  type OpenIssueSnapshot,
  type PgClientLike,
  type SnapshotIssue,
} from "./types";

export const FIXERRORS_MUTE_HOURS = 24 * 30;
const MUTE_MS = FIXERRORS_MUTE_HOURS * 60 * 60 * 1000;
const CLOSE_OUTCOMES = new Set(["acknowledged", "muted", "pending-release"]);

export type CloseOutcome = "acknowledged" | "muted" | "pending-release";

export type CloseManifestEntry = {
  issueId: string;
  outcome: CloseOutcome;
  evidence?: string;
  nextStep?: string;
};

export type CloseDecision =
  | "acknowledged"
  | "would-acknowledge"
  | "pending-release"
  | "would-pending-release"
  | "muted"
  | "would-mute"
  | "skipped-stale"
  | "skipped-not-open"
  | "skipped-missing";

export type CloseIssueResult = {
  issueId: string;
  decision: CloseDecision;
  reason: string;
  detail?: string;
  changedDuringRun: boolean;
};

export type CloseRunResult = {
  runId: string;
  applied: boolean;
  results: CloseIssueResult[];
  summaryPath?: string;
};

export function parseCloseManifest(raw: unknown, snapshotIssueIds: string[]): CloseManifestEntry[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { issues?: unknown }).issues)) {
    throw new Error("Close manifest requires an issues array");
  }
  const entries = (raw as { issues: unknown[] }).issues.map(parseCloseEntry);
  if (new Set(entries.map((entry) => entry.issueId)).size !== entries.length) {
    throw new Error("Close manifest contains duplicate issue IDs");
  }
  const expected = [...snapshotIssueIds].sort();
  const actual = entries.map((entry) => entry.issueId).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error("Close manifest must account for every snapshot issue exactly once");
  }
  return entries;
}

export function readCloseManifest(path: string, snapshotIssueIds: string[]): CloseManifestEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error("Close manifest must be valid JSON");
  }
  return parseCloseManifest(parsed, snapshotIssueIds);
}

export function decideCloseIssue(
  snapshotIssue: SnapshotIssue | undefined,
  live: LiveMonitoringIssue | undefined,
  entry: CloseManifestEntry,
): CloseIssueResult {
  if (!snapshotIssue) {
    return { issueId: entry.issueId, decision: "skipped-missing", reason: "Issue was not in the snapshot", changedDuringRun: false };
  }
  if (!live) {
    return { issueId: snapshotIssue.id, decision: "skipped-missing", reason: "Issue no longer exists", changedDuringRun: false };
  }
  const fingerprintMatches = live.fingerprint === snapshotIssue.fingerprint;
  const unchanged = fingerprintMatches && identityUnchanged(snapshotIssue, live);
  const changedDuringRun = fingerprintMatches && !unchanged;
  if (!fingerprintMatches) {
    return {
      issueId: snapshotIssue.id,
      decision: "skipped-stale",
      reason: "fingerprint changed after export",
      changedDuringRun: true,
    };
  }
  if (!canCloseOpenIssue(live.status, entry.outcome)) {
    return {
      issueId: snapshotIssue.id,
      decision: "skipped-not-open",
      reason: `Status is ${live.status}`,
      changedDuringRun,
    };
  }
  return {
    issueId: snapshotIssue.id,
    decision: decisionFor(entry.outcome),
    reason: closeReason(entry.outcome, changedDuringRun),
    detail: entry.nextStep,
    changedDuringRun,
  };
}

export function renderCloseSummary(input: {
  generatedAt: string;
  snapshotId: string;
  runId: string;
  results: CloseIssueResult[];
}): string {
  const pending = input.results.filter((result) => result.decision === "pending-release" && !result.changedDuringRun);
  const acknowledged = input.results.filter((result) => result.decision === "acknowledged" && !result.changedDuringRun);
  const muted = input.results.filter((result) => result.decision === "muted" && !result.changedDuringRun);
  const changed = input.results.filter(
    (result) => result.changedDuringRun && (
      result.decision === "acknowledged" || result.decision === "muted" || result.decision === "pending-release"
    ),
  );
  return [
    "# Fixerrors summary",
    "",
    `> Generated: ${input.generatedAt}`,
    `> Snapshot: ${input.snapshotId}`,
    `> Run: ${input.runId}`,
    "",
    "## Pending release",
    "",
    ...formatSection(pending, (result) => `- \`${result.issueId}\`: ${result.detail ?? result.reason}`),
    "",
    "## Acknowledged",
    "",
    ...formatSection(acknowledged, (result) => `- \`${result.issueId}\`: ${result.detail ?? result.reason}`),
    "",
    "## Muted",
    "",
    ...formatSection(muted, (result) => `- \`${result.issueId}\`: ${result.detail ?? result.reason}`),
    "",
    "## Changed during the run",
    "",
    ...formatSection(
      changed,
      (result) => `- \`${result.issueId}\` left ${result.decision} because it changed after export. Next step: ${result.detail ?? result.reason}`,
    ),
    "",
  ].join("\n");
}

export async function closeSnapshotIssues(input: {
  client: PgClientLike;
  snapshot: OpenIssueSnapshot;
  entries: CloseManifestEntry[];
  apply: boolean;
  databaseTargetFingerprint: string;
  actorAdminId: string;
  now?: Date;
  summaryPath?: string;
}): Promise<CloseRunResult> {
  const now = input.now ?? new Date();
  assertSnapshotUsable(input.snapshot, input.databaseTargetFingerprint, now);
  if (input.snapshot.safetyContract !== FIXERRORS_SAFETY_CONTRACT) {
    throw new Error("Safety contract mismatch");
  }
  parseCloseManifest({ issues: input.entries }, input.snapshot.issues.map((issue) => issue.id));

  const runId = randomUUID();
  const snapshotById = new Map(input.snapshot.issues.map((issue) => [issue.id, issue]));
  let committed = false;
  await input.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const liveById = await selectIssuesForUpdate(input.client, input.snapshot.issues.map((issue) => issue.id));
    const results = input.entries.map((entry) =>
      decideCloseIssue(snapshotById.get(entry.issueId), liveById.get(entry.issueId), entry),
    );
    if (!input.apply) {
      await input.client.query("ROLLBACK");
      return { runId, applied: false, results };
    }
    const blocked = results.filter((result) => result.decision.startsWith("skipped"));
    if (blocked.length > 0) {
      throw new Error(`Close-out blocked: ${blocked.map((result) => `${result.issueId} ${result.decision}`).join(", ")}`);
    }
    for (const result of results) {
      await applyCloseResult({
        client: input.client,
        result,
        snapshotIssue: snapshotById.get(result.issueId),
        live: liveById.get(result.issueId),
        actorAdminId: input.actorAdminId,
        runId,
        snapshotId: input.snapshot.snapshotId,
        now,
      });
    }
    await input.client.query("COMMIT");
    committed = true;
    const summaryPath = input.summaryPath ?? resolve(process.cwd(), "private", "fixerrors", "summary.md");
    writeAndVerifyTextArtifactAtomic(summaryPath, renderCloseSummary({
      generatedAt: now.toISOString(),
      snapshotId: input.snapshot.snapshotId,
      runId,
      results,
    }));
    return { runId, applied: true, results, summaryPath };
  } catch (error) {
    if (!committed) await input.client.query("ROLLBACK");
    throw error;
  }
}

function parseCloseEntry(issue: unknown): CloseManifestEntry {
  if (!issue || typeof issue !== "object") throw new Error("Close manifest issue is invalid");
  const record = issue as Record<string, unknown>;
  const issueId = typeof record.issueId === "string" ? record.issueId.trim() : "";
  const outcome = typeof record.outcome === "string" ? record.outcome : "";
  if (outcome === "resolved") {
    throw new Error("Close-out cannot resolve an issue before production deployment. Use pending-release, then --verify-release.");
  }
  if (!issueId || !CLOSE_OUTCOMES.has(outcome)) {
    throw new Error("Close manifest issue requires an id and outcome");
  }
  return {
    issueId,
    outcome: outcome as CloseOutcome,
    nextStep: sanitizeNextStep(typeof record.nextStep === "string" ? record.nextStep : ""),
  };
}

function decisionFor(outcome: CloseOutcome): CloseDecision {
  if (outcome === "muted") return "would-mute";
  if (outcome === "pending-release") return "would-pending-release";
  return "would-acknowledge";
}

function closeReason(outcome: CloseOutcome, changedDuringRun: boolean): string {
  if (changedDuringRun) return "Changed during the run";
  if (outcome === "muted") return "Expected noise";
  if (outcome === "pending-release") return "Fixed on staging; waiting for production deployment";
  return "Needs a person";
}

function canCloseOpenIssue(status: string, outcome: CloseOutcome): boolean {
  if (status === "OPEN" || status === "ACKNOWLEDGED") return true;
  return outcome === "muted" && status === "MUTED";
}

function formatSection(results: CloseIssueResult[], line: (result: CloseIssueResult) => string): string[] {
  return results.length === 0 ? ["- None"] : results.map(line);
}

async function applyCloseResult(input: {
  client: PgClientLike;
  result: CloseIssueResult;
  snapshotIssue: SnapshotIssue | undefined;
  live: LiveMonitoringIssue | undefined;
  actorAdminId: string;
  runId: string;
  snapshotId: string;
  now: Date;
}): Promise<void> {
  const snapshotIssue = input.snapshotIssue;
  const live = input.live;
  if (!snapshotIssue || !live || !input.result.decision.startsWith("would-")) return;
  if (input.result.decision === "would-pending-release") {
    await applyAcknowledged(input.client, snapshotIssue, live, input.result, input);
    input.result.decision = "pending-release";
    return;
  }
  if (input.result.decision === "would-acknowledge") {
    await applyAcknowledged(input.client, snapshotIssue, live, input.result, input);
    input.result.decision = "acknowledged";
    return;
  }
  if (input.result.decision === "would-mute") {
    await applyMuted(input.client, snapshotIssue, live, input.result, input);
    input.result.decision = "muted";
  }
}

async function applyAcknowledged(
  client: PgClientLike,
  snapshotIssue: SnapshotIssue,
  live: LiveMonitoringIssue,
  result: CloseIssueResult,
  run: { actorAdminId: string; runId: string; snapshotId: string; now: Date },
): Promise<void> {
  const nextStep = sanitizeNextStep(result.detail ?? "");
  const severity = requireMonitoringSeverity(live.severity, snapshotIssue.severity);
  const update = await client.query(
    `UPDATE "MonitoringIssue"
     SET status = 'ACKNOWLEDGED',
         "acknowledgedAt" = COALESCE("acknowledgedAt", $2),
         "acknowledgedSeverity" = COALESCE("acknowledgedSeverity", $3::"MonitoringSeverity"),
         "mutedUntil" = NULL,
         "resolvedAt" = NULL,
         "updatedAt" = $2
     WHERE id = $1
       AND status IN ('OPEN', 'ACKNOWLEDGED')
       AND fingerprint = $4`,
    [snapshotIssue.id, run.now, severity, snapshotIssue.fingerprint],
  );
  if ((update.rowCount ?? 0) !== 1) {
    throw new Error(`Failed to record follow-up for ${snapshotIssue.id}; transaction rolled back`);
  }
  await insertStatusEvent(client, {
    issueId: snapshotIssue.id,
    fromStatus: live.status,
    toStatus: "ACKNOWLEDGED",
    notes: nextStep,
    now: run.now,
  });
  await insertAdminAudit(client, {
    adminId: run.actorAdminId,
    action: "FIXERRORS_ACKNOWLEDGE_MONITORING_ISSUE",
    issueId: snapshotIssue.id,
    details: { runId: run.runId, snapshotId: run.snapshotId, nextStep },
    now: run.now,
  });
}

async function applyMuted(
  client: PgClientLike,
  snapshotIssue: SnapshotIssue,
  live: LiveMonitoringIssue,
  result: CloseIssueResult,
  run: { actorAdminId: string; runId: string; snapshotId: string; now: Date },
): Promise<void> {
  const nextStep = sanitizeNextStep(result.detail ?? "");
  const mutedUntil = new Date(run.now.getTime() + MUTE_MS);
  const update = await client.query(
    `UPDATE "MonitoringIssue"
     SET status = 'MUTED',
         "mutedUntil" = $2,
         "acknowledgedAt" = NULL,
         "acknowledgedSeverity" = NULL,
         "resolvedAt" = NULL,
         "updatedAt" = $3
     WHERE id = $1
       AND status IN ('OPEN', 'ACKNOWLEDGED', 'MUTED')
       AND fingerprint = $4`,
    [snapshotIssue.id, mutedUntil, run.now, snapshotIssue.fingerprint],
  );
  if ((update.rowCount ?? 0) !== 1) throw new Error(`Failed to mute ${snapshotIssue.id}; transaction rolled back`);
  await insertStatusEvent(client, {
    issueId: snapshotIssue.id,
    fromStatus: live.status,
    toStatus: "MUTED",
    notes: nextStep,
    now: run.now,
  });
  await insertAdminAudit(client, {
    adminId: run.actorAdminId,
    action: "FIXERRORS_MUTE_MONITORING_ISSUE",
    issueId: snapshotIssue.id,
    details: { runId: run.runId, snapshotId: run.snapshotId, nextStep, mutedUntil: mutedUntil.toISOString() },
    now: run.now,
  });
}
