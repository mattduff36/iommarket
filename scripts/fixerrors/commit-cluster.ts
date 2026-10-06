import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assessStagingBranch, blobAtRef, requireHeadSha, type GitRunner, type RepairWorkspace } from "./git-policy";
import { appendAlertLog } from "./alert-log";
import { recordKnowledge } from "./knowledge";
import { clusterFingerprint, sealReleaseManifest, type ReleaseContext } from "./release";

const AUTO_REPAIR_LANES = new Set(["fast", "standard", "guarded"]);
const BLOCKED_PATH = /(^|\/)\.env|(^|\/)prisma\/migrations\/|(^|\/)private\//i;

export interface ClusterReview {
  testsPassed: boolean;
  independentReview: boolean;
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
  return JSON.parse(readFileSync(path, "utf8")) as ClusterReview;
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
  if (!input.apply || !review) return { ok: true as const, committed: false };
  if (!input.release) {
    return { ok: false as const, committed: false, reason: "Commit requires the signed snapshot release context" };
  }

  const cwd = input.root ?? process.cwd();
  const run = input.runCommand ?? gitRunner;
  const added = run(["add", "--", ...input.paths], cwd);
  if (added.status !== 0) return { ok: false as const, committed: false, reason: "git add failed" };
  const committed = run(["commit", "-m", `fix: ${input.clusterId} ${review.summary}`], cwd);
  if (committed.status !== 0) return { ok: false as const, committed: false, reason: "git commit failed" };
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
    version: 1,
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
  });
  const manifestPath = resolve(cwd, "private", "fixerrors", "runs", input.clusterId, "release.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true as const, committed: true, fixCommitSha, releasePath: manifestPath };
}

function gitRunner(args: string[], cwd: string) {
  if (args.includes("push")) return { status: 1, stdout: "", stderr: "" };
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}
