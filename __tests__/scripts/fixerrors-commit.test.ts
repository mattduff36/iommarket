import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  reviewer: "independent-review-agent",
  reviewerEvidence: "separate review result in private review report",
  reviewedDiffSha256: createHash("sha256").update("reviewed staged diff").digest("hex"),
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
    runCommand: (args: string[], _cwd?: string, _env?: Record<string, string | undefined>) => {
      commands.push(args);
      if (args[0] === "diff" && args.includes("--name-only")) return { status: 0, stdout: "lib/monitoring/alerts.ts\0", stderr: "" };
      if (args[0] === "diff" && args.includes("--binary")) return { status: 0, stdout: "reviewed staged diff", stderr: "" };
      if (args[0] === "write-tree") return { status: 0, stdout: `${"e".repeat(40)}\n`, stderr: "" };
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
    expect(commands.some((args) => args[0] === "read-tree")).toBe(true);
    expect(commands.some((args) => args[0] === "write-tree")).toBe(true);
    const manifest = verifyReleaseManifest(JSON.parse(readFileSync(result.releasePath, "utf8")));
    expect(manifest.fixCommitSha).toBe("a".repeat(40));
    expect(manifest.clusterFingerprint).toBe(fingerprint);
    expect(manifest.productionSha).toBe("c".repeat(40));
    expect(manifest.postFixBlobs["lib/monitoring/alerts.ts"]).toBe("a".repeat(40));
    expect(manifest.reviewedDiffSha256).toBe(review.reviewedDiffSha256);
    expect(manifest.reviewer).toBe(review.reviewer);
  });

  it("validates a dry run against a temporary index without changing the real index", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-index-"));
    const commands: Array<{ args: string[]; env?: Record<string, string | undefined> }> = [];
    const input = commitInput(root, []);
    input.apply = false;
    input.runCommand = (args: string[], _cwd?: string, env?: Record<string, string | undefined>) => {
      commands.push({ args, env });
      if (args[0] === "diff" && args.includes("--name-only")) return { status: 0, stdout: "lib/monitoring/alerts.ts\0", stderr: "" };
      if (args[0] === "diff" && args.includes("--binary")) return { status: 0, stdout: "reviewed staged diff", stderr: "" };
      if (args[0] === "write-tree") return { status: 0, stdout: `${"e".repeat(40)}\n`, stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(commitVerifiedCluster(input)).toEqual({ ok: true, committed: false });
    const isolatedIndex = commands.find((command) => command.args[0] === "read-tree")?.env?.GIT_INDEX_FILE;
    expect(isolatedIndex).toBeTruthy();
    expect(commands.filter((command) => ["read-tree", "diff"].includes(command.args[0] ?? "") && command.env).every((command) => command.env?.GIT_INDEX_FILE === isolatedIndex)).toBe(true);
    expect(commands.some((command) => command.args[0] === "commit")).toBe(false);
    expect(commands.some((command) => command.args[0] === "write-tree")).toBe(true);
  });

  it("refuses to overwrite an existing cluster release manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-manifest-"));
    const manifestPath = join(root, "private", "fixerrors", "runs", "cluster-1", "release.json");
    mkdirSync(join(root, "private", "fixerrors", "runs", "cluster-1"), { recursive: true });
    writeFileSync(manifestPath, "prior manifest");
    const commands: string[][] = [];
    expect(commitVerifiedCluster(commitInput(root, commands))).toMatchObject({
      committed: false,
      reason: expect.stringMatching(/refusing to overwrite/),
    });
    expect(commands).toEqual([]);
    expect(readFileSync(manifestPath, "utf8")).toBe("prior manifest");
  });

  it("refuses content that differs from the independently reviewed diff", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-diff-"));
    const commands: string[][] = [];
    const input = commitInput(root, commands);
    input.runCommand = (args: string[]) => {
      commands.push(args);
      if (args[0] === "diff" && args.includes("--name-only")) return { status: 0, stdout: "lib/monitoring/alerts.ts\0", stderr: "" };
      if (args[0] === "diff" && args.includes("--binary")) return { status: 0, stdout: "different diff", stderr: "" };
      if (args[0] === "write-tree") return { status: 0, stdout: `${"e".repeat(40)}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(commitVerifiedCluster(input)).toMatchObject({ committed: false, reason: expect.stringMatching(/differs from the independently reviewed diff/) });
    expect(commands.some((args) => args[0] === "commit")).toBe(false);
  });

  it("commits the staged reviewed tree in isolation and preserves concurrent unrelated staging", () => {
    const root = mkdtempSync(join(tmpdir(), "fixerrors-git-integration-"));
    const git = (args: string[], env?: NodeJS.ProcessEnv) => spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    const run = (args: string[], cwd: string, env?: Record<string, string | undefined>) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };
    try {
      expect(git(["init"]).status).toBe(0);
      expect(git(["checkout", "-b", "staging"]).status).toBe(0);
      expect(git(["config", "user.name", "Fixerrors Test"]).status).toBe(0);
      expect(git(["config", "user.email", "fixerrors@example.test"]).status).toBe(0);
      mkdirSync(join(root, "lib", "monitoring"), { recursive: true });
      writeFileSync(join(root, "lib", "monitoring", "alerts.ts"), "before\n");
      writeFileSync(join(root, "unrelated.ts"), "base\n");
      expect(git(["add", "--all"]).status).toBe(0);
      expect(git(["commit", "-m", "baseline"]).status).toBe(0);
      mkdirSync(join(root, "lib", "config"), { recursive: true });
      writeFileSync(join(root, "lib", "config", "fixerrors-knowledge.json"), "{\"version\":1,\"entries\":[]}\n");

      writeFileSync(join(root, "lib", "monitoring", "alerts.ts"), "reviewed repair\n");
      expect(git(["add", "--", "lib/monitoring/alerts.ts"]).status).toBe(0);
      const stagedDiff = git(["diff", "--cached", "--binary", "--", "lib/monitoring/alerts.ts"]);
      const input = commitInput(root, []);
      input.review = { ...review, reviewedDiffSha256: createHash("sha256").update(stagedDiff.stdout ?? "").digest("hex") };
      input.runCommand = (args: string[], cwd?: string, env?: Record<string, string | undefined>) => {
        if (args[0] === "read-tree" && env?.GIT_INDEX_FILE && !readFileSync(join(root, "unrelated.ts"), "utf8").includes("concurrent")) {
          writeFileSync(join(root, "unrelated.ts"), "concurrent staged change\n");
          expect(git(["add", "--", "unrelated.ts"]).status).toBe(0);
        }
        return run(args, cwd ?? root, env);
      };

      expect(commitVerifiedCluster(input)).toMatchObject({ ok: true, committed: true });
      expect(git(["diff", "--cached", "--name-only", "-z"]).stdout).toBe("unrelated.ts\0");
      expect(git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout).toBe("lib/monitoring/alerts.ts\n");
      expect(git(["show", "HEAD:unrelated.ts"]).stdout).toBe("base\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
