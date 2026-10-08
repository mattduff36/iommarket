import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clusterErrorPatterns, describeCodeBaseline, generateAnalysisReport, groupOpenIssues } from "@/scripts/fixerrors/analysis";
import { assertAutoRepairDecision, buildFixerrorsDecisions, clusterRepairBlockReason } from "@/scripts/fixerrors/decision";
import { assessExplicitRepairPaths, compareRepairPaths } from "@/scripts/fixerrors/git-policy";
import { extractSourceFilesForIssue, parseStackTrace } from "@/scripts/fixerrors/source-extraction";
import type { ErrorRootCauseCluster, SnapshotIssue } from "@/scripts/fixerrors/types";

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

  it("parses stack frames independently and preserves Next route-group parentheses", () => {
    const refs = parseStackTrace([
      "./actions/admin/users.ts",
      "    at loadUsers (webpack-internal:///./app/(admin)/admin/users/page.tsx:42:7)",
    ].join("\n"));
    expect(refs).toEqual([
      { file: "actions/admin/users.ts" },
      { file: "app/(admin)/admin/users/page.tsx", line: 42, column: 7 },
    ]);
  });

  it("does not let a source frame consume the next stack line", () => {
    expect(parseStackTrace("./actions/admin/users.ts\n./app/(admin)/admin/users/page.tsx").map((ref) => ref.file)).toEqual([
      "actions/admin/users.ts",
      "app/(admin)/admin/users/page.tsx",
    ]);
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

  it("suggests mute for user input and follow-up for external or unknown issues", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([
      makeIssue({
        id: "input",
        fingerprint: "fp-input",
        sampleMessage: "Invalid input for required field",
        sampleAction: "saveDraft",
        sampleRoute: null,
        events: [],
      }),
      makeIssue({
        id: "net",
        fingerprint: "fp-net",
        sampleMessage: "Failed to fetch third-party map tiles",
        sampleAction: "loadMap",
        sampleRoute: null,
        events: [],
      }),
      makeIssue({
        id: "mystery",
        fingerprint: "fp-mystery",
        sampleMessage: "Widget blew up",
        sampleAction: "unknownWidget",
        sampleRoute: "/not-a-real-monitoring-route",
        events: [],
      }),
    ]));
    const decisions = buildFixerrorsDecisions(clusters);
    expect(decisions.find((decision) => decision.issueIds.includes("input"))?.action).toBe("mute-noise");
    expect(decisions.find((decision) => decision.issueIds.includes("net"))?.action).toBe("needs-person");
    expect(decisions.find((decision) => decision.issueIds.includes("mystery"))?.action).toBe("needs-person");
  });

  it("classifies underscore-separated payment settings as critical money issues", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([makeIssue({
      id: "payment-config",
      sampleMessage: "PAYMENT_PROVIDER_KEY is missing",
      sampleAction: "create_payment_intent",
      events: [],
    })]));
    expect(clusters[0]).toMatchObject({ rootCauseFamily: "money-billing", lane: "critical", action: "critical-gates" });
  });

  it("classifies missing-relation SQL errors as critical database issues", () => {
    const clusters = clusterErrorPatterns(groupOpenIssues([makeIssue({
      id: "missing-relation",
      sampleMessage: 'relation "listing_images" does not exist',
      sampleAction: "loadListing",
      events: [],
    })]));
    expect(clusters[0]).toMatchObject({ rootCauseFamily: "database-persistence", lane: "critical", action: "critical-gates" });
  });
});

describe("FXMON-REVIEW-001 selected issue subsets", () => {
  const decision = {
    clusterId: "cluster-4",
    lane: "standard",
    action: "auto-repair" as const,
    issueIds: ["issue-a", "issue-b", "issue-c"],
    blockReason: null,
  };

  it("allows a nonempty subset of the reviewed decision issue IDs", () => {
    expect(() => assertAutoRepairDecision([decision], "cluster-4", ["issue-a", "issue-c"])).not.toThrow();
  });

  it.each([
    { issueIds: [] },
    { issueIds: ["issue-a", "issue-a"] },
    { issueIds: ["issue-outside-cluster"] },
  ])("rejects empty, duplicate, or unknown selected IDs: $issueIds", ({ issueIds }) => {
    expect(() => assertAutoRepairDecision([decision], "cluster-4", issueIds)).toThrow(/unique subset/);
  });

  it("still blocks decisions that are not unblocked auto-repairs", () => {
    expect(() => assertAutoRepairDecision([{ ...decision, action: "needs-person", blockReason: "needs review" }], "cluster-4", ["issue-a"])).toThrow(/needs review/);
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

describe("production and staging code baselines", () => {
  const file = "lib/monitoring/alerts.ts";
  const cluster: ErrorRootCauseCluster = {
    id: "cluster-1",
    rootCauseFamily: "application",
    lane: "fast",
    action: "fix",
    issueIds: ["issue-1"],
    occurrences: 1,
    patterns: [{
      patternKey: "boom",
      issueIds: ["issue-1"],
      errorType: "Error",
      component: "alerts",
      normalizedMessage: "boom",
      occurrences: 1,
      sourceFiles: [{ file }],
      affectedPages: [],
      firstSeen: "2026-08-16T12:00:00.000Z",
      lastSeen: "2026-08-16T12:00:00.000Z",
    }],
  };

  it("blocks auto-repair unless the file exists in both refs", () => {
    const missing = {
      productionSha: "a".repeat(40),
      stagingSha: "b".repeat(40),
      paths: [{ file, productionBlob: "c".repeat(40), stagingBlob: null }],
    };
    expect(clusterRepairBlockReason(cluster, null)).toMatch(/not compared/);
    expect(buildFixerrorsDecisions([cluster], missing)[0]).toMatchObject({
      action: "needs-person",
      blockReason: `${file} is not present in both origin/main and origin/staging`,
    });
    expect(generateAnalysisReport([], [], [cluster], missing)).toContain("| needs-person |");
    const present = {
      productionSha: "a".repeat(40),
      stagingSha: "b".repeat(40),
      paths: [{ file, productionBlob: "c".repeat(40), stagingBlob: "d".repeat(40) }],
    };
    expect(buildFixerrorsDecisions([cluster], present)[0]).toMatchObject({
      action: "auto-repair",
      blockReason: null,
    });
    expect(describeCodeBaseline(present).join("\n")).toContain("staging differs from production");
    expect(generateAnalysisReport([], [], [cluster], present)).toContain(`origin/main: \`${"a".repeat(40)}\``);
  });

  it("records blob hashes from origin/main and origin/staging", () => {
    const baseline = compareRepairPaths({
      files: [file, "lib/missing.ts"],
      productionSha: "a".repeat(40),
      stagingSha: "b".repeat(40),
      cwd: process.cwd(),
      run: (args) => {
        const spec = args[1] ?? "";
        if (spec === `${"a".repeat(40)}:${file}`) return { status: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" };
        if (spec === `${"b".repeat(40)}:${file}`) return { status: 0, stdout: `${"d".repeat(40)}\n`, stderr: "" };
        return { status: 1, stdout: "", stderr: "" };
      },
    });
    expect(baseline.paths).toEqual([
      { file: "lib/missing.ts", productionBlob: null, stagingBlob: null },
      { file, productionBlob: "c".repeat(40), stagingBlob: "d".repeat(40) },
    ]);
  });

  it("allows explicitly requested existing files when they are present in both signed refs", () => {
    const assessed = assessExplicitRepairPaths({
      paths: [file, "lib/extra-helper.ts"],
      newPaths: [],
      baseline: { productionSha: "a".repeat(40), stagingSha: "b".repeat(40) },
      cwd: process.cwd(),
      run: (args) => {
        const spec = args[1] ?? "";
        if (spec === `${"a".repeat(40)}:lib/extra-helper.ts` || spec === `${"b".repeat(40)}:lib/extra-helper.ts`) {
          return { status: 0, stdout: "c".repeat(40), stderr: "" };
        }
        if (spec === `${"a".repeat(40)}:${file}` || spec === `${"b".repeat(40)}:${file}`) {
          return { status: 0, stdout: "d".repeat(40), stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      },
    });
    expect(assessed).toEqual({ ok: true, paths: [file, "lib/extra-helper.ts"], newPaths: [] });
  });

  it("allows a requested new helper only when explicitly declared and absent from refs and HEAD", () => {
    const assessed = assessExplicitRepairPaths({
      paths: ["lib/new-helper.ts"],
      newPaths: ["lib/new-helper.ts"],
      baseline: { productionSha: "a".repeat(40), stagingSha: "b".repeat(40) },
      cwd: process.cwd(),
      run: () => ({ status: 1, stdout: "", stderr: "" }),
    });
    expect(assessed).toEqual({ ok: true, paths: ["lib/new-helper.ts"], newPaths: ["lib/new-helper.ts"] });
  });

  it("allows explicitly declared new regression tests under __tests__", () => {
    const assessed = assessExplicitRepairPaths({
      paths: ["__tests__/scripts/new-regression.test.ts"],
      newPaths: ["__tests__/scripts/new-regression.test.ts"],
      baseline: { productionSha: "a".repeat(40), stagingSha: "b".repeat(40) },
      cwd: process.cwd(),
      run: () => ({ status: 1, stdout: "", stderr: "" }),
    });
    expect(assessed.ok).toBe(true);
  });

  it("requires undeclared existing paths in both refs and rejects pre-existing declared-new paths", () => {
    const baseline = { productionSha: "a".repeat(40), stagingSha: "b".repeat(40) };
    const missingFromStaging = assessExplicitRepairPaths({
      paths: [file], newPaths: [], baseline, cwd: process.cwd(),
      run: (args) => args[1] === `${"a".repeat(40)}:${file}`
        ? { status: 0, stdout: "c".repeat(40), stderr: "" }
        : { status: 1, stdout: "", stderr: "" },
    });
    expect(missingFromStaging).toMatchObject({ ok: false, reason: expect.stringContaining("both origin/main and origin/staging") });

    const alreadyInHead = assessExplicitRepairPaths({
      paths: ["lib/new-helper.ts"], newPaths: ["lib/new-helper.ts"], baseline, cwd: process.cwd(),
      run: (args) => args[1] === "HEAD:lib/new-helper.ts"
        ? { status: 0, stdout: "e".repeat(40), stderr: "" }
        : { status: 1, stdout: "", stderr: "" },
    });
    expect(alreadyInHead).toMatchObject({ ok: false, reason: expect.stringContaining("already exists in HEAD") });
  });

  it.each([
    { paths: ["lib/helper.ts"], newPaths: ["lib/other.ts"] },
    { paths: ["../secrets.ts"], newPaths: [] },
    { paths: ["/lib/helper.ts"], newPaths: [] },
    { paths: ["lib/.env.local.ts"], newPaths: [] },
    { paths: ["lib/private/helper.ts"], newPaths: [] },
    { paths: ["prisma/migrations/secret.ts"], newPaths: [] },
  ])("rejects undeclared or unsafe explicit paths: $paths", ({ paths, newPaths }) => {
    expect(assessExplicitRepairPaths({
      paths,
      newPaths,
      baseline: { productionSha: "a".repeat(40), stagingSha: "b".repeat(40) },
      cwd: process.cwd(),
      run: () => ({ status: 1, stdout: "", stderr: "" }),
    }).ok).toBe(false);
  });
});
