import { readInvestigation } from "@/lib/monitoring/investigation";
import { diagnosticTarget } from "@/lib/monitoring/request-diagnostics";
import { redactFreeText } from "@/lib/monitoring/redact";
import { contentChecksum } from "./integrity";
import type { ReleaseManifest } from "./release";
import { verifySnapshot } from "./snapshot";
import type { OpenIssueSnapshot, SnapshotIssue } from "./types";

export function issueWorkKey(issue: Pick<SnapshotIssue, "id" | "fingerprint">): string {
  return contentChecksum([issue.id, issue.fingerprint]).slice(0, 24);
}

function metrics(issues: SnapshotIssue[], now: number) {
  const records = issues.map(issue => readInvestigation(issue.investigation));
  return { unresolved: issues.length, occurrences: issues.reduce((sum, issue) => sum + issue.occurrences, 0),
    missingPlans: records.filter(record => !record).length,
    overdue: records.filter(record => record && Date.parse(record.reviewAfter) <= now).length,
    pendingReleases: records.filter(record => record?.outcome === "pending-release").length };
}

function compareBaseline(snapshot: OpenIssueSnapshot, previous?: OpenIssueSnapshot | null) {
  if (!previous) return "no-previous-snapshot";
  try { verifySnapshot(previous); }
  catch { return "invalid-previous-snapshot"; }
  const before = Date.parse(previous.exportedAt), after = Date.parse(snapshot.exportedAt);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "invalid-previous-snapshot";
  if (previous.databaseTargetFingerprint !== snapshot.databaseTargetFingerprint) return "different-database";
  return before > after ? "previous-is-newer" : "matched";
}

export function pendingReleaseIssueIds(snapshot: OpenIssueSnapshot, manifests: Pick<ReleaseManifest, "issueIds" | "issueFingerprints">[]) {
  const current = new Map(snapshot.issues.map(issue => [issue.id, issue.fingerprint]));
  return [...new Set(manifests.flatMap(manifest => manifest.issueIds.filter((id, index) =>
    current.has(id) && current.get(id) === manifest.issueFingerprints[index])))];
}

export function buildWorkQueue(snapshot: OpenIssueSnapshot, previous?: OpenIssueSnapshot | null, pendingIssueIds: string[] = [], now = new Date(snapshot.exportedAt)) {
  const comparison = compareBaseline(snapshot, previous);
  const before = comparison === "matched" ? previous : undefined;
  const prior = new Map(before?.issues.map(issue => [issueWorkKey(issue), issue]));
  const pending = new Set(pendingIssueIds);
  const items = snapshot.issues.map(issue => {
    const old = prior.get(issueWorkKey(issue));
    const record = readInvestigation(issue.investigation);
    const occurrenceDelta = old && issue.occurrences >= old.occurrences ? issue.occurrences - old.occurrences : null;
    const userReport = [issue.sampleAction, issue.sampleComponent, ...issue.events.map(event => event.action)]
      .some(value => /^user-report(?:-issue)?$/i.test(value ?? ""));
    const reasons = [
      issue.severity === "CRITICAL" ? "critical" : null,
      userReport ? "user-report" : null,
      !old ? "new" : null,
      occurrenceDelta !== null && occurrenceDelta > 0 ? "occurrence-delta" : null,
      record && Date.parse(record.reviewAfter) <= now.getTime() ? "overdue-review" : null,
      old && contentChecksum([old.events, old.investigationChecksum ?? old.investigation]) !== contentChecksum([issue.events, issue.investigationChecksum ?? issue.investigation]) ? "changed-evidence" : null,
      pending.has(issue.id) || record?.outcome === "pending-release" ? "pending-release" : null,
      record?.observedLastSeenAt && Date.parse(issue.lastSeenAt) > Date.parse(record.observedLastSeenAt) ? "recurrence" : null,
    ].filter((reason): reason is string => reason !== null);
    const priority = reasons.includes("critical") ? -2 : userReport ? -1
      : reasons.includes("new") ? 0 : reasons.includes("occurrence-delta") || reasons.includes("recurrence") ? 1
      : reasons.includes("overdue-review") ? 2 : reasons.includes("changed-evidence") ? 3 : reasons.includes("pending-release") ? 4 : 5;
    return { key: issueWorkKey(issue), issueId: issue.id, reasons, priority, occurrenceDelta };
  }).sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return { comparison, before: before ? metrics(before.issues, now.getTime()) : null, after: metrics(snapshot.issues, now.getTime()),
    metrics: { newIssues: items.filter(item => item.reasons.includes("new")).length,
      occurrenceDelta: items.reduce((sum, item) => sum + (item.occurrenceDelta ?? 0), 0) },
    items, bursts: burstHints(snapshot.issues) };
}

function burstHints(issues: SnapshotIssue[]) {
  const groups = new Map<string, { label: string; route: string; release: string; browser: string; windowStart: string; issueIds: string[] }>();
  for (const issue of issues.slice(0, 5_000)) {
    for (const event of issue.events.slice(0, 10)) {
      const route = diagnosticTarget(event.route ?? event.requestPath ?? "", "https://itrader.im");
      const release = event.evidence?.clientRelease ?? event.evidence?.serverRelease;
      const browser = event.evidence?.browserFamily;
      const time = Date.parse(event.occurredAt);
      if (!route || typeof release !== "string" || !/^[a-f0-9]{40}$/i.test(release)
        || typeof browser !== "string" || !["Safari", "Chrome", "Firefox", "Edge"].includes(browser) || !Number.isFinite(time)) continue;
      const windowStart = new Date(Math.floor(time / 300_000) * 300_000).toISOString();
      const key = `${route}|${release}|${browser}|${windowStart}`;
      if (!groups.has(key) && groups.size >= 5_000) continue;
      const group = groups.get(key) ?? { label: "Possible burst (report-only hint; alerts remain independent)", route, release, browser, windowStart, issueIds: [] };
      if (!group.issueIds.includes(issue.id) && group.issueIds.length < 20) group.issueIds.push(issue.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter(group => group.issueIds.length > 1).slice(0, 20);
}

export function fixCandidatesFromLog(log: string, linkedCommits: string[]) {
  const linked = new Set(linkedCommits);
  return log.split(/\r?\n/).slice(0, 50).flatMap(line => {
    const [sha, ...subjectParts] = line.split("\t");
    const subject = subjectParts.join(" ").slice(0, 160);
    if (!sha || !/^[a-f0-9]{40}$/.test(sha) || !/\b(fix|repair|resolve|patch)\b/i.test(subject) || linked.has(sha)) return [];
    return [{ sha, subject: redactFreeText(subject).replace(/[|`]/g, ""), linkage: "unlinked", deployment: "unverified", causality: "unverified" }];
  }).slice(0, 20);
}

export function renderWorkQueue(queue: ReturnType<typeof buildWorkQueue>, candidates: ReturnType<typeof fixCandidatesFromLog> = []): string[] {
  return ["## Prioritized work queue", "", `Comparison: ${queue.comparison}. Counts are frozen at export start; a new fingerprint is not an occurrence delta.`,
    `Before: ${JSON.stringify(queue.before)}. After: ${JSON.stringify(queue.after)}. Deltas: ${JSON.stringify(queue.metrics)}.`,
    "", "| Stable key | Issue | Work | New occurrences |", "|---|---|---|---:|",
    ...queue.items.map(item => `| ${item.key} | ${item.issueId} | ${item.reasons.join(", ") || "unchanged backlog"} | ${item.occurrenceDelta ?? "n/a"} |`),
    "", "### Possible bursts (not root causes)", "", ...queue.bursts.map(group => JSON.stringify(group)),
    "", "### Merged fix candidates without alert linkage", "",
    "Bounded to 50 commits / 30 days on the fetched production branch. Deployment and causality are unverified; no automatic resolution.",
    ...candidates.map(candidate => `- ${candidate.sha}: ${candidate.subject} (unlinked; deployment unverified; causality unverified)`), ""];
}
