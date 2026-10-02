import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { recordKnowledge } from "./knowledge";

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
  paths: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (input.pushRequested) return { ok: false, reason: "Push is not allowed" };
  if (!AUTO_REPAIR_LANES.has(input.lane)) {
    return { ok: false, reason: "Only fast, standard, and guarded clusters can be committed automatically" };
  }
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
  paths: string[];
  apply: boolean;
  pushRequested?: boolean;
  root?: string;
  runCommand?: (args: string[], cwd: string) => { status: number | null };
}) {
  const assessment = assessClusterCommit({
    lane: input.lane,
    pushRequested: input.pushRequested ?? false,
    review: input.review,
    clusterIssueIds: input.clusterIssueIds,
    paths: input.paths,
  });
  if (!assessment.ok) return { committed: false, ...assessment };
  if (!input.apply || !input.review) return { ok: true as const, committed: false };

  const cwd = input.root ?? process.cwd();
  const run = input.runCommand ?? defaultGit;
  const added = run(["add", "--", ...input.paths], cwd);
  if (added.status !== 0) return { ok: false as const, committed: false, reason: "git add failed" };
  const committed = run([
    "commit",
    "-m",
    `fix: ${input.clusterId} ${input.review.summary}`,
  ], cwd);
  if (committed.status !== 0) return { ok: false as const, committed: false, reason: "git commit failed" };

  recordKnowledge({
    fingerprint: input.fingerprint,
    lane: input.lane as "fast" | "standard" | "guarded",
    outcome: "fixed",
    summary: input.review.summary,
    files: input.paths,
    tests: input.review.tests,
  }, cwd);
  const manifestPath = resolve(cwd, "private", "fixerrors", "runs", input.clusterId, "commit.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    clusterId: input.clusterId,
    lane: input.lane,
    issueIds: input.clusterIssueIds,
    evidence: input.review.evidence,
    committed: true,
  }, null, 2)}\n`);
  return { ok: true as const, committed: true };
}

function defaultGit(args: string[], cwd: string) {
  if (args.includes("push")) return { status: 1 };
  const result = spawnSync("git", args, { cwd, stdio: "inherit" });
  return { status: result.status };
}
