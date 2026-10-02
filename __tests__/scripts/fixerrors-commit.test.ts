import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessClusterCommit, commitVerifiedCluster } from "@/scripts/fixerrors/commit-cluster";
import { buildFixerrorsDecisions } from "@/scripts/fixerrors/decision";
import type { ErrorRootCauseCluster } from "@/scripts/fixerrors/types";

const review = {
  testsPassed: true,
  independentReview: true,
  evidence: "vitest monitoring-alert-policy",
  issueIds: ["issue-1"],
  summary: "Normalize the alert retry delay",
  tests: ["__tests__/lib/monitoring-alert-policy.test.ts"],
};

describe("fixerrors automatic repair gates", () => {
  it("routes critical work to approval and refuses unsafe commits", () => {
    const cluster = {
      id: "cluster-1",
      lane: "critical",
      action: "critical-gates",
      issueIds: ["issue-1"],
    } as ErrorRootCauseCluster;
    expect(buildFixerrorsDecisions([cluster])[0]?.action).toBe("pause-for-approval");
    expect(assessClusterCommit({
      lane: "critical",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
    }).ok).toBe(false);
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: true,
      review,
      clusterIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
    })).toMatchObject({ reason: "Push is not allowed" });
  });

  it("commits one reviewed non-critical cluster without pushing", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-"));
    mkdirSync(join(root, "lib", "config"), { recursive: true });
    writeFileSync(join(root, "lib", "config", "fixerrors-knowledge.json"), "{\"version\":1,\"entries\":[]}\n");
    const commands: string[][] = [];
    const result = commitVerifiedCluster({
      lane: "fast",
      clusterId: "cluster-1",
      fingerprint: "a".repeat(64),
      review,
      clusterIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      apply: true,
      root,
      runCommand: (args) => {
        commands.push(args);
        return { status: args.includes("push") ? 1 : 0 };
      },
    });

    expect(result).toMatchObject({ ok: true, committed: true });
    expect(commands.some((args) => args.includes("push"))).toBe(false);
    expect(commands[0]).toEqual(["add", "--", "lib/monitoring/alerts.ts"]);
  });
});
