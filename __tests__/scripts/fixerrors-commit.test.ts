import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessClusterCommit, commitVerifiedCluster } from "@/scripts/fixerrors/commit-cluster";
import { buildFixerrorsDecisions } from "@/scripts/fixerrors/decision";
import { assessRepairWorkspace } from "@/scripts/fixerrors/git-policy";
import { clusterFingerprint, verifyReleaseManifest } from "@/scripts/fixerrors/release";
import { FIXERRORS_SAFETY_CONTRACT, type ErrorRootCauseCluster } from "@/scripts/fixerrors/types";

const review = {
  testsPassed: true,
  independentReview: true,
  evidence: "vitest monitoring-alert-policy",
  issueIds: ["issue-1"],
  summary: "Normalize the alert retry delay",
  tests: ["__tests__/lib/monitoring-alert-policy.test.ts"],
};

const fingerprints = ["fp-1"];
const fingerprint = clusterFingerprint(fingerprints);
const stagingWorkspace = { branch: "staging", behindOriginStaging: 0, dirtyPaths: [] as string[] };

function commitInput(root: string, commands: string[][]) {
  return {
    lane: "fast",
    clusterId: "cluster-1",
    fingerprint,
    review,
    clusterIssueIds: ["issue-1"],
    snapshotIssueIds: ["issue-1"],
    paths: ["lib/monitoring/alerts.ts"],
    workspace: stagingWorkspace,
    issueFingerprints: fingerprints,
    release: {
      safetyContract: FIXERRORS_SAFETY_CONTRACT,
      snapshotId: "11111111-1111-4111-8111-111111111111",
      snapshotChecksum: "b".repeat(64),
      productionSha: "c".repeat(40),
      stagingSha: "d".repeat(40),
    },
    apply: true,
    root,
    runCommand: (args: string[]) => {
      commands.push(args);
      if (args[0] === "rev-parse") return { status: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      return { status: args.includes("push") ? 1 : 0, stdout: "", stderr: "" };
    },
  };
}

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
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: stagingWorkspace,
      fingerprint,
      issueFingerprints: fingerprints,
    }).ok).toBe(false);
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: true,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: stagingWorkspace,
      fingerprint,
      issueFingerprints: fingerprints,
    })).toMatchObject({ reason: "Push is not allowed" });
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: { branch: "main", behindOriginStaging: 0, dirtyPaths: [] },
      fingerprint,
      issueFingerprints: fingerprints,
    })).toMatchObject({ reason: "Repair must be committed on staging" });
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: { branch: "", behindOriginStaging: 0, dirtyPaths: [] },
      fingerprint,
      issueFingerprints: fingerprints,
    })).toMatchObject({ reason: expect.stringMatching(/detached HEAD/) });
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: { branch: "staging", behindOriginStaging: 2, dirtyPaths: [] },
      fingerprint,
      issueFingerprints: fingerprints,
    })).toMatchObject({ reason: expect.stringMatching(/behind origin\/staging/) });
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: stagingWorkspace,
      fingerprint: "f".repeat(64),
      issueFingerprints: fingerprints,
    })).toMatchObject({ reason: expect.stringMatching(/signed issue fingerprints/) });
    expect(assessRepairWorkspace(
      { branch: "staging", behindOriginStaging: 0, dirtyPaths: ["lib/monitoring/alerts.ts"] },
      ["lib/monitoring/alerts.ts"],
    ).ok).toBe(false);
    expect(assessClusterCommit({
      lane: "fast",
      pushRequested: false,
      review,
      clusterIssueIds: ["issue-1"],
      snapshotIssueIds: ["issue-1"],
      paths: ["lib/monitoring/alerts.ts"],
      workspace: { ...stagingWorkspace, dirtyPaths: ["lib/monitoring/alerts.ts"] },
      fingerprint,
      issueFingerprints: fingerprints,
    }).ok).toBe(true);
  });

  it("commits one reviewed staging cluster and writes a signed release manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-"));
    mkdirSync(join(root, "lib", "config"), { recursive: true });
    writeFileSync(join(root, "lib", "config", "fixerrors-knowledge.json"), "{\"version\":1,\"entries\":[]}\n");
    const commands: string[][] = [];
    const result = commitVerifiedCluster(commitInput(root, commands));

    expect(result).toMatchObject({ ok: true, committed: true, fixCommitSha: "a".repeat(40) });
    if (!("releasePath" in result) || !result.releasePath) throw new Error("missing release manifest");
    expect(commands.some((args) => args.includes("push"))).toBe(false);
    expect(commands[0]).toEqual(["add", "--", "lib/monitoring/alerts.ts"]);
    const manifest = verifyReleaseManifest(JSON.parse(readFileSync(result.releasePath, "utf8")));
    expect(manifest.fixCommitSha).toBe("a".repeat(40));
    expect(manifest.clusterFingerprint).toBe(fingerprint);
    expect(manifest.productionSha).toBe("c".repeat(40));
    expect(manifest.postFixBlobs["lib/monitoring/alerts.ts"]).toBe("a".repeat(40));
  });
});
