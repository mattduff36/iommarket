import { describe, expect, it } from "vitest";
import { assertBoundRepairDecision, serializeDecisionManifest } from "@/scripts/fixerrors/decision";
import { markSnapshotAnalysisCompleted, sealSnapshot, verifySnapshot } from "@/scripts/fixerrors/snapshot";
import { FIXERRORS_COMMAND_ID, FIXERRORS_SAFETY_CONTRACT, FIXERRORS_SNAPSHOT_VERSION } from "@/scripts/fixerrors/types";

const baseline = { productionSha: "a".repeat(40), stagingSha: "b".repeat(40), paths: [] };
const issue = { id: "one", fingerprint: "fp-one", status: "OPEN" as const, severity: "HIGH", source: "SERVER",
  title: "Crash", lastSeenAt: "2026-11-14T00:00:00Z", occurrences: 1, sampleMessage: "Crash",
  sampleRoute: null, sampleAction: null, sampleComponent: null, events: [] };
const snapshot = sealSnapshot({ version: FIXERRORS_SNAPSHOT_VERSION, commandId: FIXERRORS_COMMAND_ID,
  safetyContract: FIXERRORS_SAFETY_CONTRACT, snapshotId: "snapshot-one", databaseTargetFingerprint: "a".repeat(64),
  exportedAt: "2026-11-15T00:00:00Z", expiresAt: "2026-11-15T00:30:00Z", issues: [issue],
  analysis: { status: "pending", reportPath: "private/fixerrors/error-analysis.md", reportChecksum: null,
    completedAt: null, clusterCount: 0, clusterLanes: {}, reportOnlyIssueIds: [], codeBaseline: null } });
const decisions = [{ clusterId: "cluster-1", lane: "fast", action: "auto-repair" as const, issueIds: ["one"], blockReason: null }];
const text = serializeDecisionManifest(snapshot, decisions, baseline);
const bound = markSnapshotAnalysisCompleted(snapshot, "report", { fast: 1 }, 1, [], baseline,
  new Date("2026-11-15T00:01:00Z"), text);

describe("decision integrity binding (not a signature)", () => {
  it("accepts only the snapshot-bound bytes and requested lane", () => {
    expect(() => assertBoundRepairDecision(bound, text, "cluster-1", ["one"], "fast", new Date("2026-11-15T00:02:00Z"))).not.toThrow();
    expect(() => assertBoundRepairDecision(bound, text, "cluster-1", ["one"], "guarded")).toThrow(/lane/i);
  });
  it("requires re-export for legacy unbound decisions without breaking snapshot readability", () => {
    expect(verifySnapshot(snapshot)).toEqual(snapshot);
    const archived = sealSnapshot({ ...snapshot, safetyContract: "fixerrors-open-issues-v3" });
    expect(verifySnapshot(archived)).toEqual(archived);
    expect(() => assertBoundRepairDecision(snapshot, JSON.stringify({ version: 2, decisions }), "cluster-1", ["one"], "fast")).toThrow(/re-export/i);
  });
  it("checks semantic membership, snapshot and baseline bindings even when bytes are integrity-bound", () => {
    const payload = { version: 3, snapshotId: snapshot.snapshotId, issueChecksum: snapshot.checksum, codeBaseline: baseline, decisions };
    const cases = [
      ["{", /JSON/],
      [JSON.stringify({ ...payload, unexpected: true }), /Unrecognized/],
      [JSON.stringify({ ...payload, snapshotId: "other" }), /snapshot ID/],
      [JSON.stringify({ ...payload, issueChecksum: "0".repeat(64) }), /snapshot ID/],
      [JSON.stringify({ ...payload, codeBaseline: { ...baseline, productionSha: "c".repeat(40) } }), /baseline/],
      [JSON.stringify({ ...payload, decisions: [] }), /membership/],
      [JSON.stringify({ ...payload, decisions: [decisions[0], decisions[0]] }), /membership/],
      [JSON.stringify({ ...payload, decisions: [{ ...decisions[0], issueIds: ["other"] }] }), /membership/],
    ] as const;
    for (const [content, message] of cases) {
      const candidate = markSnapshotAnalysisCompleted(snapshot, "report", { fast: 1 }, 1, [], baseline,
        new Date("2026-11-15T00:01:00Z"), content);
      expect(() => assertBoundRepairDecision(candidate, content, "cluster-1", ["one"], "fast", new Date("2026-11-15T00:02:00Z"))).toThrow(message);
    }
  });
  it("rejects tampering, stale manifests, malformed content and mismatched issue membership", () => {
    for (const content of ["{", text + " ", text.replace("snapshot-one", "snapshot-two"), text.replace('"one"', '"other"')]) {
      expect(() => assertBoundRepairDecision(bound, content, "cluster-1", ["one"], "fast")).toThrow();
    }
    expect(() => assertBoundRepairDecision(bound, text, "cluster-1", ["one"], "fast", new Date("2026-11-15T01:00:00Z"))).toThrow(/expired/i);
  });
});
