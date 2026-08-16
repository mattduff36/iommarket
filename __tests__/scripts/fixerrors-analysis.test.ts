import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clusterErrorPatterns, groupOpenIssues } from "@/scripts/fixerrors/analysis";
import { extractSourceFilesForIssue } from "@/scripts/fixerrors/source-extraction";
import type { SnapshotIssue } from "@/scripts/fixerrors/types";

function makeIssue(overrides: Partial<SnapshotIssue> = {}): SnapshotIssue {
  return {
    id: overrides.id ?? "issue-1",
    fingerprint: overrides.fingerprint ?? "fp-1",
    title: overrides.title ?? "Boom",
    status: "OPEN",
    severity: overrides.severity ?? "HIGH",
    source: overrides.source ?? "SERVER",
    lastSeenAt: overrides.lastSeenAt ?? "2026-08-16T12:00:00.000Z",
    occurrences: overrides.occurrences ?? 2,
    sampleMessage: overrides.sampleMessage ?? "Payment failed for listing 123",
    sampleRoute: overrides.sampleRoute ?? "/sell/checkout",
    sampleAction: overrides.sampleAction ?? "payForListing",
    sampleComponent: overrides.sampleComponent ?? null,
    events: overrides.events ?? [
      {
        id: "event-1",
        source: "SERVER",
        severity: "HIGH",
        environment: "production",
        message: overrides.sampleMessage ?? "Payment failed for listing 123",
        stack: "Error: boom\n    at payForListing (./actions/payments.ts:101:12)",
        route: overrides.sampleRoute ?? "/sell/checkout",
        action: overrides.sampleAction ?? "payForListing",
        component: null,
        requestPath: "/sell/checkout",
        occurredAt: "2026-08-16T12:00:00.000Z",
      },
    ],
  };
}

describe("FXMON-ANALYSIS-001 source mapping", () => {
  it("groups issues and maps stack/route/action evidence to repository files", () => {
    const root = mkdtempSync(join(tmpdir(), "fxmon-source-"));
    try {
      mkdirSync(join(root, "actions"), { recursive: true });
      writeFileSync(join(root, "actions", "payments.ts"), "export async function payForListing() {}\n");
      const issue = makeIssue();
      const refs = extractSourceFilesForIssue(issue, root);
      expect(refs.some((ref) => ref.file.endsWith("actions/payments.ts"))).toBe(true);

      const patterns = groupOpenIssues([issue], root);
      expect(patterns).toHaveLength(1);
      expect(patterns[0]?.issueIds).toEqual(["issue-1"]);
      expect(patterns[0]?.sourceFiles.some((ref) => ref.file.includes("actions/payments.ts"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("FXMON-ROUTING-002 cluster routing", () => {
  it("isolates CRITICAL clusters and keeps external/user-input clusters report-only", () => {
    const clusters = clusterErrorPatterns(
      groupOpenIssues([
        makeIssue({
          id: "auth",
          fingerprint: "fp-auth",
          sampleMessage: "RLS permission denied for table listings",
          sampleAction: "saveListing",
          events: [
            {
              id: "e-auth",
              source: "SERVER",
              severity: "HIGH",
              environment: "production",
              message: "RLS permission denied for table listings",
              stack: null,
              route: "/api/listings",
              action: "saveListing",
              component: null,
              requestPath: "/api/listings",
              occurredAt: "2026-08-16T12:00:00.000Z",
            },
          ],
        }),
        makeIssue({
          id: "net",
          fingerprint: "fp-net",
          sampleMessage: "Failed to fetch third-party map tiles",
          sampleAction: "loadMap",
          source: "CLIENT",
        }),
      ]),
    );

    expect(
      clusters.find((cluster) => cluster.rootCauseFamily === "auth-permissions-security"),
    ).toMatchObject({ lane: "critical", action: "critical-gates" });
    expect(
      clusters.find((cluster) => cluster.rootCauseFamily === "external-network"),
    ).toMatchObject({ lane: "report-only", action: "report-only" });
  });
});

describe("FXMON-SCOPE-003 OPEN-only grouping", () => {
  it("includes all OPEN issues and excludes non-OPEN issues", () => {
    const openA = makeIssue({ id: "open-a", fingerprint: "fp-a", sampleMessage: "A" });
    const openB = makeIssue({ id: "open-b", fingerprint: "fp-b", sampleMessage: "B" });
    const resolved = {
      ...makeIssue({ id: "resolved", fingerprint: "fp-c", sampleMessage: "C" }),
      status: "RESOLVED" as const,
    };

    const patterns = groupOpenIssues([openA, openB, resolved as unknown as SnapshotIssue]);
    const ids = patterns.flatMap((pattern) => pattern.issueIds);
    expect(ids).toEqual(expect.arrayContaining(["open-a", "open-b"]));
    expect(ids).not.toContain("resolved");
  });
});
