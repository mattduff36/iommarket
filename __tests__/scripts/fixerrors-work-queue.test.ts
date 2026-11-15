import { describe, expect, it } from "vitest";
import { buildWorkQueue, fixCandidatesFromLog, pendingReleaseIssueIds } from "@/scripts/fixerrors/work-queue";
import { sealSnapshot } from "@/scripts/fixerrors/snapshot";
import { FIXERRORS_COMMAND_ID, FIXERRORS_SAFETY_CONTRACT, FIXERRORS_SNAPSHOT_VERSION, type SnapshotIssue } from "@/scripts/fixerrors/types";

function issue(id: string, overrides: Partial<SnapshotIssue> = {}): SnapshotIssue {
  return { id, fingerprint: `fp-${id}`, title: "Crash", status: "ACKNOWLEDGED", severity: "HIGH", source: "CLIENT",
    occurrences: 3, lastSeenAt: "2026-11-14T10:01:00Z", sampleMessage: "Crash", sampleRoute: "/search",
    sampleAction: null, sampleComponent: null, events: [], ...overrides };
}
function snapshot(issues: SnapshotIssue[], database = "a".repeat(64)) {
  return sealSnapshot({ version: FIXERRORS_SNAPSHOT_VERSION, commandId: FIXERRORS_COMMAND_ID, safetyContract: FIXERRORS_SAFETY_CONTRACT,
    snapshotId: "current", databaseTargetFingerprint: database, exportedAt: "2026-11-15T00:00:00Z", expiresAt: "2026-11-15T00:30:00Z", issues,
    analysis: { status: "pending", reportPath: "private/fixerrors/error-analysis.md", reportChecksum: null, completedAt: null,
      clusterCount: 0, clusterLanes: {}, reportOnlyIssueIds: [], codeBaseline: null } });
}
describe("prioritized work queue", () => {
  it("keeps critical incidents and explicit user reports ahead of routine new alerts", () => {
    const critical = issue("critical", { severity: "CRITICAL" });
    const report = issue("report", { sampleAction: "user-report-issue" });
    const prior = snapshot([critical, report, issue("old")]);
    const queue = buildWorkQueue(snapshot([issue("new"), issue("old"), report, critical]), prior);
    expect(queue.items.slice(0, 2).map(item => item.issueId)).toEqual(["critical", "report"]);
    expect(queue.items[0]?.reasons).toContain("critical");
    expect(queue.items[1]?.reasons).toContain("user-report");
  });
  it("prioritizes new/delta/release work ahead of unchanged backlog and keeps stable identity", () => {
    const saved = snapshot([issue("old"), issue("delta")]);
    const current = snapshot([issue("old"), issue("new"), issue("delta", { occurrences: 5 })]);
    const queue = buildWorkQueue(current, saved, ["old"]);
    expect(queue.items.find(i => i.issueId === "delta")?.occurrenceDelta).toBe(2);
    expect(queue.items[0]?.issueId).toBe("new");
    expect(queue.metrics.newIssues).toBe(1);
    expect(buildWorkQueue(snapshot([...current.issues].reverse()), saved, ["old"]).items.find(i => i.issueId === "old")?.key)
      .toBe(queue.items.find(i => i.issueId === "old")?.key);
  });
  it("never subtracts counts across database or fingerprint identities", () => {
    expect(buildWorkQueue(snapshot([issue("old")]), snapshot([issue("old", { occurrences: 99 })], "b".repeat(64))).comparison).toBe("different-database");
    expect(buildWorkQueue(snapshot([issue("old", { fingerprint: "changed" })]), snapshot([issue("old")])).metrics.newIssues).toBe(1);
  });
  it("rejects tampered, invalid-date and future baselines and never reports negative occurrence deltas", () => {
    const current = snapshot([issue("old")]);
    const prior = snapshot([issue("old", { occurrences: 99 })]);
    expect(buildWorkQueue(current, { ...prior, checksum: "0".repeat(64) }).comparison).toBe("invalid-previous-snapshot");
    expect(buildWorkQueue(current, sealSnapshot({ ...prior, exportedAt: "invalid" })).comparison).toBe("invalid-previous-snapshot");
    expect(buildWorkQueue(current, sealSnapshot({ ...prior, exportedAt: "2026-11-16T00:00:00Z" })).comparison).toBe("previous-is-newer");
    expect(buildWorkQueue(current, prior).items[0]?.occurrenceDelta).toBeNull();
    expect(buildWorkQueue(current, prior).metrics.occurrenceDelta).toBe(0);
  });
  it("does not link archived release work to a changed fingerprint", () => {
    const current = snapshot([issue("same"), issue("changed", { fingerprint: "new-fingerprint" })]);
    expect(pendingReleaseIssueIds(current, [{ issueIds: ["same", "changed"], issueFingerprints: ["fp-same", "fp-changed"] }])).toEqual(["same"]);
  });
  it("reports bursts only as bounded hints and never removes individual or explicit reports", () => {
    const events = [{ id: "e", source: "CLIENT", severity: "HIGH", environment: "production", message: "Crash",
      stack: null, route: "/search", requestPath: "/search", action: null, component: null,
      occurredAt: "2026-11-14T10:01:00Z", evidence: { browserFamily: "Safari", clientRelease: "a".repeat(40) } }];
    const queue = buildWorkQueue(snapshot([issue("one", { events }), issue("two", { events }), issue("report", { sampleAction: "user-report", events })]));
    expect(queue.items).toHaveLength(3);
    expect(queue.bursts[0]?.issueIds).toContain("report");
    expect(queue.bursts[0]?.label).toMatch(/hint/i);
  });
  it("labels unlinked git fixes as unverified candidates, not resolved causes", () => {
    const candidates = fixCandidatesFromLog(`${"a".repeat(40)}\tfix: image timeout\n${"b".repeat(40)}\tfeat: widget`, []);
    expect(candidates).toEqual([{ sha: "a".repeat(40), subject: "fix: image timeout", linkage: "unlinked", deployment: "unverified", causality: "unverified" }]);
    expect(fixCandidatesFromLog(`${"a".repeat(40)}\tfix: already linked`, ["a".repeat(40)])).toEqual([]);
    expect(fixCandidatesFromLog(Array.from({ length: 100 }, (_, i) => `${i.toString(16).padStart(40, "0")}\tfix: candidate`).join("\n"), [])).toHaveLength(20);
  });
});
