import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alertLogPath,
  appendAlertLog,
  applyAlertHistory,
  newSeenEvents,
  recallOpenIssues,
  type AlertLogEvent,
  type AlertLogSubject,
} from "@/scripts/fixerrors/alert-log";
import type { FixerrorsDecision } from "@/scripts/fixerrors/decision";

function issue(overrides: Partial<AlertLogSubject> = {}): AlertLogSubject {
  return {
    id: "issue-1",
    fingerprint: "fp-1",
    title: "Search failed",
    sampleMessage: "Invalid prisma query relation listings does not exist on the search page",
    source: "SERVER",
    sampleRoute: "/search",
    sampleAction: "render",
    severity: "HIGH",
    occurrences: 4,
    lastSeenAt: "2026-10-06T18:00:00.000Z",
    ...overrides,
  };
}

describe("fixerrors alert log", () => {
  it("records a new alert once and recalls it on the next launch", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-log-"));
    const current = issue();
    const first = newSeenEvents([current], [], new Date("2026-10-06T12:00:00.000Z"));
    appendAlertLog(first, root);
    expect(newSeenEvents([current], first)).toHaveLength(0);

    const recalls = recallOpenIssues([current], first);
    expect(recalls[0]?.note).toContain("logged 1 time before");
    expect(recalls[0]?.fixFailed).toBe(false);
    expect(readFileSync(alertLogPath(root), "utf8")).toContain("\"outcome\":\"seen\"");
  });

  it("indexes history by fingerprint and uses the newest seen record for deduplication", () => {
    const current = issue();
    const latest = newSeenEvents([current], [], new Date("2026-10-06T12:00:00.000Z"))[0]!;
    const older = {
      ...latest,
      at: "2026-10-05T12:00:00.000Z",
      occurrences: 1,
      lastSeenAt: "2026-10-05T11:00:00.000Z",
    };

    expect(newSeenEvents([current], [latest, older])).toEqual([]);
  });

  it("refuses to repeat a fix that the same error came back after", () => {
    const current = issue({ lastSeenAt: "2026-10-06T18:00:00.000Z" });
    const history: AlertLogEvent[] = [
      {
        at: "2026-10-01T10:00:00.000Z",
        fingerprint: "fp-1",
        normalizedMessage: "relation listings does not exist",
        source: "SERVER",
        route: "/search",
        action: "render",
        severity: "HIGH",
        occurrences: 2,
        lastSeenAt: "2026-10-01T09:00:00.000Z",
        outcome: "fixed",
        summary: "Add the missing listings table",
        files: ["prisma/schema.prisma"],
      },
    ];
    const recalls = recallOpenIssues([current], history);
    expect(recalls[0]?.fixFailed).toBe(true);
    expect(recalls[0]?.note).toContain("Do not repeat it");
    expect(recalls[0]?.note).toContain("prisma/schema.prisma");

    const decision: FixerrorsDecision = {
      clusterId: "cluster-1",
      lane: "fast",
      action: "auto-repair",
      issueIds: ["issue-1"],
      blockReason: null,
    };
    expect(applyAlertHistory([decision], recalls)[0]).toMatchObject({
      action: "needs-person",
      blockReason: expect.stringMatching(/Do not repeat/),
    });
  });

  it("suggests a similar earlier fix without blocking a new error", () => {
    const current = issue({
      id: "issue-2",
      fingerprint: "fp-2",
      sampleMessage: "Invalid prisma query relation listings does not exist while rendering search",
    });
    const history: AlertLogEvent[] = [
      {
        at: "2026-10-02T10:00:00.000Z",
        fingerprint: "fp-old",
        normalizedMessage: "Invalid prisma query relation listings does not exist on the search page",
        source: "SERVER",
        route: "/search",
        action: "render",
        severity: "HIGH",
        occurrences: 1,
        lastSeenAt: "2026-10-02T09:00:00.000Z",
        outcome: "fixed",
        summary: "Restore the listings query",
        files: ["app/search/page.tsx"],
      },
    ];
    const recall = recallOpenIssues([current], history)[0];
    expect(recall?.fixFailed).toBe(false);
    expect(recall?.note).toContain("similar error");
    expect(recall?.note).toContain("Restore the listings query");
  });
});
