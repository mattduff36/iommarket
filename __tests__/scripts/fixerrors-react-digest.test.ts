import { describe, expect, it } from "vitest";
import { clusterErrorPatterns, generateAnalysisReport, groupOpenIssues } from "@/scripts/fixerrors/analysis";
import { buildFixerrorsDecisions } from "@/scripts/fixerrors/decision";
import type { SnapshotIssue } from "@/scripts/fixerrors/types";

function react441Issue(): SnapshotIssue {
  return {
    id: "react-441",
    fingerprint: "react-441-fingerprint",
    title: "Minified React error #441",
    status: "OPEN",
    severity: "MEDIUM",
    source: "CLIENT",
    lastSeenAt: "2026-10-06T20:10:40.995Z",
    occurrences: 33,
    sampleMessage: "Minified React error #441; visit the decoder for details.",
    sampleRoute: "/search",
    sampleAction: null,
    sampleComponent: null,
    events: [{
      id: "client-event",
      source: "CLIENT",
      severity: "MEDIUM",
      environment: "production",
      message: "Minified React error #441",
      stack: null,
      route: "/search",
      action: null,
      component: null,
      requestPath: "/search",
      digest: "digest-441",
      traceId: "iad1::trace_123",
      occurredAt: "2026-10-06T20:10:40.995Z",
    }],
  };
}

describe("fixerrors React server-component digest guidance", () => {
  it("routes React 441 to human investigation instead of automatic repair", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([react441Issue()]));
    expect(clusters[0]).toMatchObject({
      rootCauseFamily: "react-server-components-digest",
      lane: "report-only",
      action: "report-only",
    });
    expect(buildFixerrorsDecisions(clusters)[0]?.action).toBe("needs-person");
  });

  it("reports allowlisted client correlation fields and requires a matching server event", () => {
    const issue = react441Issue();
    const patterns = groupOpenIssues([issue]);
    const report = generateAnalysisReport([issue], patterns, clusterErrorPatterns(patterns));
    expect(report).toContain("same route and nearby timestamp");
    expect(report).toContain("digest=digest-441");
    expect(report).toContain("traceId=iad1::trace_123");
    expect(report).toContain("Without that evidence, keep the issue open");
  });
});
