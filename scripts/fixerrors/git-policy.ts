import { spawnSync } from "node:child_process";
import type { CodeBaseline, CodePathBaseline } from "./types";

const GIT_SHA = /^[0-9a-f]{40}$/iu;

export type GitResult = { status: number | null; stdout: string; stderr: string };
export type GitRunner = (args: string[], cwd: string) => GitResult;

export type RepairWorkspace = {
  branch: string;
  behindOriginStaging: number;
  dirtyPaths: string[];
};

export function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export function fetchReleaseRefs(
  cwd: string,
  run: GitRunner = runGit,
): { productionSha: string; stagingSha: string } {
  const fetched = run(["fetch", "origin", "main", "staging"], cwd);
  if (fetched.status !== 0) {
    throw new Error("Refusing fixerrors: could not fetch origin/main and origin/staging.");
  }
  return {
    productionSha: requireSha(run(["rev-parse", "origin/main"], cwd), "origin/main"),
    stagingSha: requireSha(run(["rev-parse", "origin/staging"], cwd), "origin/staging"),
  };
}

export function blobAtRef(
  ref: string,
  file: string,
  cwd: string,
  run: GitRunner = runGit,
): string | null {
  const result = run(["rev-parse", `${ref}:${file}`], cwd);
  const sha = result.stdout.trim().toLowerCase();
  return result.status === 0 && GIT_SHA.test(sha) ? sha : null;
}

export function compareRepairPaths(input: {
  files: string[];
  productionSha: string;
  stagingSha: string;
  cwd: string;
  run?: GitRunner;
}): CodeBaseline {
  const run = input.run ?? runGit;
  const paths = [...new Set(input.files)].sort().map((file): CodePathBaseline => ({
    file,
    productionBlob: blobAtRef(input.productionSha, file, input.cwd, run),
    stagingBlob: blobAtRef(input.stagingSha, file, input.cwd, run),
  }));
  return { productionSha: input.productionSha, stagingSha: input.stagingSha, paths };
}

export function assessStagingBranch(
  workspace: RepairWorkspace,
): { ok: true } | { ok: false; reason: string } {
  if (!workspace.branch) {
    return { ok: false, reason: "Repair must be committed on staging, not a detached HEAD" };
  }
  if (workspace.branch !== "staging") {
    return { ok: false, reason: "Repair must be committed on staging" };
  }
  if (workspace.behindOriginStaging > 0) {
    return { ok: false, reason: "Local staging is behind origin/staging" };
  }
  return { ok: true };
}

export function assessRepairWorkspace(
  workspace: RepairWorkspace,
  repairPaths: string[],
): { ok: true } | { ok: false; reason: string } {
  const branch = assessStagingBranch(workspace);
  if (!branch.ok) return branch;
  const dirty = repairPaths.filter((file) => workspace.dirtyPaths.includes(file));
  if (dirty.length > 0) {
    return { ok: false, reason: `Repair paths must be clean before editing: ${dirty.join(", ")}` };
  }
  return { ok: true };
}

export function readRepairWorkspace(cwd: string, run: GitRunner = runGit): RepairWorkspace {
  const branch = run(["branch", "--show-current"], cwd).stdout.trim();
  const behind = run(["rev-list", "--count", "HEAD..origin/staging"], cwd);
  const behindCount = Number.parseInt(behind.stdout.trim(), 10);
  const dirtyPaths = run(["status", "--porcelain", "--"], cwd).stdout
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return {
    branch,
    behindOriginStaging: Number.isFinite(behindCount) ? behindCount : Number.POSITIVE_INFINITY,
    dirtyPaths,
  };
}

export function isAncestor(ancestor: string, descendant: string, cwd: string, run: GitRunner = runGit): boolean {
  return run(["merge-base", "--is-ancestor", ancestor, descendant], cwd).status === 0;
}

export function requireHeadSha(cwd: string, run: GitRunner = runGit): string {
  return requireSha(run(["rev-parse", "HEAD"], cwd), "HEAD");
}

export function originRepository(remoteUrl: string): { owner: string; repo: string } {
  const trimmed = remoteUrl.trim().replace(/\.git$/u, "");
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/\s]+)$/u);
  if (ssh?.[1] && ssh[2]) return { owner: ssh[1], repo: ssh[2] };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Refusing fixerrors: origin is not a GitHub repository.");
  }
  if (parsed.hostname !== "github.com") {
    throw new Error("Refusing fixerrors: origin is not a GitHub repository.");
  }
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo) throw new Error("Refusing fixerrors: origin is not a GitHub repository.");
  return { owner, repo };
}

export function readOriginUrl(cwd: string, run: GitRunner = runGit): string {
  const result = run(["remote", "get-url", "origin"], cwd);
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Refusing fixerrors: origin remote is unavailable.");
  }
  return result.stdout.trim();
}

function requireSha(result: GitResult, label: string): string {
  const sha = result.stdout.trim().toLowerCase();
  if (result.status !== 0 || !GIT_SHA.test(sha)) {
    throw new Error(`Refusing fixerrors: ${label} is unavailable.`);
  }
  return sha;
}
