import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { assessStagingBranch, blobAtRef, requireHeadSha, type GitRunner, type RepairWorkspace } from "./git-policy";
import { appendAlertLog } from "./alert-log";
import { recordKnowledge } from "./knowledge";
import { clusterFingerprint, sealReleaseManifest, type ReleaseContext } from "./release";

const AUTO_REPAIR_LANES = new Set(["fast", "standard", "guarded"]);
const BLOCKED_PATH = /(^|\/)\.env|(^|\/)prisma\/migrations\/|(^|\/)private\//i;

export interface ClusterReview {
  testsPassed: boolean;
  independentReview: boolean;
  reviewer: string;
  reviewerEvidence: string;
  reviewedDiffSha256: string;
  evidence: string;
  issueIds: string[];
  summary: string;
  tests: string[];
}

export function assessClusterCommit(input: {
  lane: string;
  pushRequested: boolean;
  review: ClusterReview | null;
  clusterIssueIds: string[];
  snapshotIssueIds: string[];
  paths: string[];
  workspace: RepairWorkspace;
  fingerprint: string;
  issueFingerprints: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (input.pushRequested) return { ok: false, reason: "Push is not allowed" };
  if (!AUTO_REPAIR_LANES.has(input.lane)) {
    return { ok: false, reason: "Only fast, standard, and guarded clusters can be committed automatically" };
  }
  const branch = assessStagingBranch(input.workspace);
  if (!branch.ok) return branch;
  if (!input.review?.testsPassed || !input.review.independentReview) {
    return { ok: false, reason: "Targeted tests and independent review must pass" };
  }
  if (!input.review.reviewer.trim() || input.review.reviewerEvidence.trim().length < 8) {
    return { ok: false, reason: "Independent reviewer identity and evidence are required" };
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.review.reviewedDiffSha256)) {
    return { ok: false, reason: "Review must identify the exact reviewed diff SHA-256" };
  }
  if (input.review.evidence.trim().length < 8) {
    return { ok: false, reason: "Commit evidence is required" };
  }
  const expected = [...input.clusterIssueIds].sort().join(",");
  const actual = [...input.review.issueIds].sort().join(",");
  if (!expected || expected !== actual) {
    return { ok: false, reason: "Review issue IDs must match the cluster exactly" };
  }
  if (input.clusterIssueIds.some((issueId) => !input.snapshotIssueIds.includes(issueId))) {
    return { ok: false, reason: "Cluster issue IDs are not in the signed snapshot" };
  }
  if (input.clusterIssueIds.length === 0 || new Set(input.clusterIssueIds).size !== input.clusterIssueIds.length) {
    return { ok: false, reason: "Reviewed issue IDs must be non-empty and unique" };
  }
  if (input.issueFingerprints.length !== input.clusterIssueIds.length) {
    return { ok: false, reason: "Signed issue fingerprints must match the cluster" };
  }
  if (input.fingerprint !== clusterFingerprint(input.issueFingerprints)) {
    return { ok: false, reason: "Cluster fingerprint does not match the signed issue fingerprints" };
  }
  if (input.paths.length === 0 || input.paths.some((file) => BLOCKED_PATH.test(file.replaceAll("\\", "/")))) {
    return { ok: false, reason: "Commit paths must be explicit and must not include secrets, migrations, or private artifacts" };
  }
  return { ok: true };
}

export function readClusterReview(path: string): ClusterReview {
  const schema = z.object({
    testsPassed: z.literal(true), independentReview: z.literal(true),
    reviewer: z.string().trim().min(1), reviewerEvidence: z.string().trim().min(8),
    reviewedDiffSha256: z.string().regex(/^[a-f0-9]{64}$/iu),
    evidence: z.string().trim().min(8), issueIds: z.array(z.string().min(1)).min(1),
    summary: z.string().trim().min(1).max(200), tests: z.array(z.string().trim().min(1)).min(1),
  });
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error("Review requires passing tests, independent reviewer evidence and the exact reviewed diff hash");
  return parsed.data;
}

export function commitVerifiedCluster(input: {
  lane: string;
  clusterId: string;
  fingerprint: string;
  review: ClusterReview | null;
  clusterIssueIds: string[];
  snapshotIssueIds: string[];
  paths: string[];
  workspace: RepairWorkspace;
  issueFingerprints: string[];
  release: ReleaseContext | null;
  apply: boolean;
  pushRequested?: boolean;
  root?: string;
  runCommand?: GitRunner;
}) {
  const assessment = assessClusterCommit({
    lane: input.lane,
    pushRequested: input.pushRequested ?? false,
    review: input.review,
    clusterIssueIds: input.clusterIssueIds,
    snapshotIssueIds: input.snapshotIssueIds,
    paths: input.paths,
    workspace: input.workspace,
    fingerprint: input.fingerprint,
    issueFingerprints: input.issueFingerprints,
  });
  if (!assessment.ok) return { committed: false, ...assessment };
  const review = input.review;
  if (!review) return { ok: true as const, committed: false };
  if (!input.release) {
    if (input.apply) return { ok: false as const, committed: false, reason: "Commit requires the signed snapshot release context" };
  }

  const cwd = input.root ?? process.cwd();
  const manifestPath = resolve(cwd, "private", "fixerrors", "runs", input.clusterId, "release.json");
  if (input.apply && existsSync(manifestPath)) {
    return { ok: false as const, committed: false, reason: "A release manifest already exists for this cluster; refusing to overwrite reviewed release evidence" };
  }
  const run = input.runCommand ?? gitRunner;
  const cachedPaths = run(["diff", "--cached", "--name-only", "-z"], cwd);
  if (cachedPaths.status !== 0) return { ok: false as const, committed: false, reason: "Could not inspect the real staged index" };
  const cachedPathList = cachedPaths.stdout.split("\0").filter(Boolean).sort();
  const allowedPathList = [...input.paths].sort();
  if (cachedPathList.join("\0") !== allowedPathList.join("\0")) {
    return { ok: false as const, committed: false, reason: "The real staged index must contain exactly the reviewed repair paths" };
  }
  const cachedDiff = run(["diff", "--cached", "--binary", "--", ...input.paths], cwd);
  if (cachedDiff.status !== 0) return { ok: false as const, committed: false, reason: "Could not read the real staged repair diff" };
  if (createHash("sha256").update(cachedDiff.stdout).digest("hex") !== review.reviewedDiffSha256.toLowerCase()) {
    return { ok: false as const, committed: false, reason: "Real staged content differs from the independently reviewed diff" };
  }
  const headAtSnapshot = run(["rev-parse", "HEAD"], cwd);
  if (headAtSnapshot.status !== 0 || !/^[a-f0-9]{40}$/iu.test(headAtSnapshot.stdout.trim())) {
    return { ok: false as const, committed: false, reason: "Could not capture HEAD before preparing the reviewed commit" };
  }
  const stagedTree = run(["write-tree"], cwd);
  if (stagedTree.status !== 0 || !/^[a-f0-9]{40}$/iu.test(stagedTree.stdout.trim())) {
    return { ok: false as const, committed: false, reason: "Could not snapshot the reviewed staged tree" };
  }
  const isolatedIndexDirectory = mkdtempSync(resolve(tmpdir(), "fixerrors-index-"));
  const isolatedIndex = resolve(isolatedIndexDirectory, "index");
  const gitEnv: Record<string, string | undefined> = { GIT_INDEX_FILE: isolatedIndex };
  try {
    const readTree = run(["read-tree", stagedTree.stdout.trim()], cwd, gitEnv);
    if (readTree.status !== 0) return { ok: false as const, committed: false, reason: "Could not initialize an isolated repair index" };
    const isolatedPaths = run(["diff", "--cached", "--name-only", "-z", "HEAD"], cwd, gitEnv);
    if (isolatedPaths.status !== 0 || isolatedPaths.stdout.split("\0").filter(Boolean).sort().join("\0") !== allowedPathList.join("\0")) {
      return { ok: false as const, committed: false, reason: "Isolated staged tree contains paths outside this reviewed repair" };
    }
    const stagedDiff = run(["diff", "--cached", "--binary", "--", ...input.paths], cwd, gitEnv);
    if (stagedDiff.status !== 0) return { ok: false as const, committed: false, reason: "Could not read the isolated repair diff" };
    const reviewedDiffSha256 = createHash("sha256").update(stagedDiff.stdout).digest("hex");
    if (reviewedDiffSha256 !== review.reviewedDiffSha256.toLowerCase()) {
      return { ok: false as const, committed: false, reason: "Repair content differs from the independently reviewed diff" };
    }
    if (!input.apply) return { ok: true as const, committed: false };
    if (!input.release) return { ok: false as const, committed: false, reason: "Commit requires the signed snapshot release context" };

    const currentHead = run(["rev-parse", "HEAD"], cwd);
    if (currentHead.status !== 0 || currentHead.stdout.trim() !== headAtSnapshot.stdout.trim()) {
      return { ok: false as const, committed: false, reason: "HEAD changed while preparing the reviewed commit" };
    }
    const committed = run(["commit", "-m", `fix: ${input.clusterId} ${review.summary}`], cwd, gitEnv);
    if (committed.status !== 0) return { ok: false as const, committed: false, reason: "git commit failed" };
  } finally {
    rmSync(isolatedIndexDirectory, { recursive: true, force: true });
  }
  const fixCommitSha = requireHeadSha(cwd, run);
  const postFixBlobs: Record<string, string> = {};
  for (const file of input.paths) {
    const blob = blobAtRef("HEAD", file, cwd, run);
    if (!blob) return { ok: false as const, committed: true, reason: `Could not hash ${file} after commit` };
    postFixBlobs[file] = blob;
  }

  recordKnowledge({
    fingerprint: input.fingerprint,
    lane: input.lane as "fast" | "standard" | "guarded",
    outcome: "fixed",
    summary: review.summary,
    files: input.paths,
    tests: review.tests,
    issueFingerprints: input.issueFingerprints,
  }, cwd);
  const recordedAt = new Date().toISOString();
  appendAlertLog(input.issueFingerprints.map((fingerprint) => ({
    at: recordedAt,
    fingerprint,
    normalizedMessage: "",
    source: "",
    route: null,
    action: null,
    severity: "",
    occurrences: 0,
    lastSeenAt: recordedAt,
    outcome: "fixed" as const,
    summary: review.summary,
    files: input.paths,
  })), cwd);
  const manifest = sealReleaseManifest({
    version: 2,
    safetyContract: input.release.safetyContract,
    snapshotId: input.release.snapshotId,
    snapshotChecksum: input.release.snapshotChecksum,
    clusterId: input.clusterId,
    issueIds: input.clusterIssueIds,
    issueFingerprints: input.issueFingerprints,
    clusterFingerprint: input.fingerprint,
    productionSha: input.release.productionSha,
    stagingSha: input.release.stagingSha,
    fixCommitSha,
    paths: input.paths,
    postFixBlobs,
    tests: review.tests,
    evidence: review.evidence,
    reviewer: review.reviewer,
    reviewerEvidence: review.reviewerEvidence,
    reviewedDiffSha256: review.reviewedDiffSha256.toLowerCase(),
  });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true as const, committed: true, fixCommitSha, releasePath: manifestPath };
}

function gitRunner(args: string[], cwd: string, env?: Record<string, string | undefined>) {
  if (args.includes("push")) return { status: 1, stdout: "", stderr: "" };
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}
