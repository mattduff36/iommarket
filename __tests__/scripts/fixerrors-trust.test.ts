import { describe, expect, it } from "vitest";
import { clusterErrorPatterns, generateAnalysisReport, groupOpenIssues } from "@/scripts/fixerrors/analysis";
import { applyAlertHistory, recallOpenIssues, type AlertLogEvent } from "@/scripts/fixerrors/alert-log";
import { buildFixerrorsDecisions } from "@/scripts/fixerrors/decision";
import { extractSourceFilesForIssue, parseStackTrace } from "@/scripts/fixerrors/source-extraction";
import type { SnapshotIssue } from "@/scripts/fixerrors/types";

const issue = (id: string, overrides: Partial<SnapshotIssue> = {}): SnapshotIssue => ({
  id, fingerprint: `fp-${id}`, title: "Widget crashed", status: "OPEN", severity: "HIGH",
  source: "SERVER", occurrences: 1, lastSeenAt: "2026-11-14T12:00:00Z",
  sampleMessage: "Widget crashed", sampleAction: null, sampleRoute: "/search", sampleComponent: null,
  events: [{ id: `e-${id}`, source: "SERVER", severity: "HIGH", environment: "production",
    message: "Widget crashed", stack: "Error\n at render (./lib/widget.ts:10:2)", route: "/search",
    action: null, component: null, requestPath: "/search", occurredAt: "2026-11-14T12:00:00Z" }],
  ...overrides,
});
const baseline = { productionSha: "a".repeat(40), stagingSha: "b".repeat(40),
  paths: [{ file: "lib/widget.ts", productionBlob: "c".repeat(40), stagingBlob: "c".repeat(40) }] };

describe("fixerrors evidence trust", () => {
  it("does not borrow a sibling issue's frame confidence", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([issue("strong"), issue("weak", { events: [], sampleRoute: null })]));
    expect(buildFixerrorsDecisions(clusters, baseline).every(d => d.action !== "auto-repair")).toBe(true);
  });
  it("ignores historical client ingest stacks unless provenance explicitly confirms the browser stack", () => {
    const historical = issue("client", { source: "CLIENT", sampleRoute: null });
    expect(extractSourceFilesForIssue(historical).some(ref => ref.file === "lib/widget.ts" || ref.confidence === "high")).toBe(false);
    const event = historical.events[0]!;
    expect(extractSourceFilesForIssue({ ...historical, events: [{ ...event, source: "CLIENT", evidence: { clientStackProvided: true } }] })[0])
      .toMatchObject({ file: "lib/widget.ts", provenance: "client-stack", confidence: "high" });
  });
  it("retains route inference as a low confidence hint", () => {
    const refs = extractSourceFilesForIssue(issue("route", { events: [], sampleRoute: "/" }));
    expect(refs[0]).toMatchObject({ provenance: "route", confidence: "low" });
  });
  it.each(["0", "999999999999999999999999999999999999"])("does not promote invalid source line %s to high confidence", line => {
    const original = issue("bad-line");
    const refs = extractSourceFilesForIssue({ ...original, events: [{ ...original.events[0]!,
      stack: `Error\n at render (./lib/widget.ts:${line}:2)` }] });
    expect(refs.some(ref => ref.confidence === "high")).toBe(false);
  });
  it.each([
    String.raw`C:\site\.next\server\app\search\page.js:10:2`,
    String.raw`C:\site\_next\static\chunks\app\search\page.js:10:2`,
  ])("does not mistake a Windows compiled frame for original source: %s", file => {
    expect(parseStackTrace(`Error\n at render (${file})`)).toEqual([]);
  });
  it("keeps a CRITICAL severity gate even for ordinary grouped messages and recurrence", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([issue("normal"), issue("critical", { severity: "CRITICAL" })]));
    const decisions = applyAlertHistory(buildFixerrorsDecisions(clusters, baseline),
      [{ issueId: "critical", earlierCount: 1, fixFailed: true, note: "Failed earlier fix" }]);
    expect(decisions[0]).toMatchObject({ lane: "critical", action: "pause-for-approval" });
  });
  it("uses the same final decisions in report recommendations", () => {
    const issues = [issue("one")], patterns = groupOpenIssues(issues), clusters = clusterErrorPatterns(patterns);
    const decisions = applyAlertHistory(buildFixerrorsDecisions(clusters, baseline),
      [{ issueId: "one", earlierCount: 1, fixFailed: true, note: "Failed earlier fix" }]);
    const report = generateAnalysisReport(issues, patterns, clusters, baseline, [], undefined, decisions);
    expect(report).toContain(`| needs-person | ${decisions[0]?.blockReason} |`);
    expect(report).not.toContain("| fix |");
  });
  it("treats identical normalized messages with different fingerprints as hints, not failed fixes", () => {
    const current = issue("new");
    const fixed: AlertLogEvent = { at: "2026-11-01T00:00:00Z", fingerprint: "old",
      normalizedMessage: current.sampleMessage, source: "SERVER", route: "/search", action: null,
      severity: "HIGH", occurrences: 1, lastSeenAt: "2026-11-01T00:00:00Z", outcome: "fixed" };
    expect(recallOpenIssues([current], [fixed])[0]).toMatchObject({ fixFailed: false, note: expect.stringContaining("similar") });
  });
});
