import { spawnSync } from "child_process";
import type { FinaliseChangedFile } from "./types";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function getExecutable(command: string) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  if (command === "npx") return "npx.cmd";
  return command;
}

function shouldUseShell(command: string) {
  if (process.platform !== "win32") return false;
  return !["git", "powershell.exe", "pwsh.exe"].includes(command.toLowerCase());
}

function quoteArg(value: string) {
  if (!/[ \t"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function runCommand(
  repoRoot: string,
  command: string,
  args: string[],
  options: { allowFailure?: boolean; captureOutput?: boolean } = {},
): CommandResult {
  const result = spawnSync(getExecutable(command), args, {
    cwd: repoRoot,
    env: process.env,
    shell: shouldUseShell(command),
    encoding: "utf8",
    stdio: options.captureOutput ? "pipe" : "inherit",
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (!options.allowFailure && result.status !== 0) {
    const rendered = [command, ...args.map(quoteArg)].join(" ");
    const extra = result.error instanceof Error ? `: ${result.error.message}` : "";
    throw new Error(`Command failed (${rendered})${extra}`);
  }
  return { status: result.status, stdout, stderr };
}

function getTrimmedLines(output: string) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getChangedFileStats(repoRoot: string): FinaliseChangedFile[] {
  const tracked = runCommand(repoRoot, "git", ["diff", "--numstat", "HEAD", "--"], { captureOutput: true });
  const untracked = runCommand(repoRoot, "git", ["ls-files", "--others", "--exclude-standard"], { captureOutput: true });
  const statsByPath = new Map<string, FinaliseChangedFile>();

  for (const line of getTrimmedLines(tracked.stdout)) {
    const [rawAdditions, rawDeletions, rawPath] = line.split(/\t/u);
    const filePath = rawPath || "";
    if (!filePath) continue;
    const additions = Number.parseInt(rawAdditions || "0", 10);
    const deletions = Number.parseInt(rawDeletions || "0", 10);
    statsByPath.set(filePath, {
      path: filePath,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  for (const filePath of getTrimmedLines(untracked.stdout)) {
    if (!statsByPath.has(filePath)) {
      statsByPath.set(filePath, { path: filePath, additions: 0, deletions: 0 });
    }
  }
  return [...statsByPath.values()];
}

export function getUnmergedFiles(repoRoot: string) {
  return getTrimmedLines(
    runCommand(repoRoot, "git", ["diff", "--name-only", "--diff-filter=U"], {
      captureOutput: true,
      allowFailure: true,
    }).stdout,
  );
}

export function hasUncommittedChanges(repoRoot: string) {
  return runCommand(repoRoot, "git", ["status", "--porcelain"], { captureOutput: true }).stdout.trim().length > 0;
}

export function getCurrentBranch(repoRoot: string) {
  return runCommand(repoRoot, "git", ["branch", "--show-current"], { captureOutput: true }).stdout.trim();
}

export function commitAllChanges(repoRoot: string, commitMessage: string) {
  if (!hasUncommittedChanges(repoRoot)) return false;
  runCommand(repoRoot, "git", ["add", "-A"]);
  runCommand(repoRoot, "git", ["commit", "-m", commitMessage]);
  return true;
}

export function pushCurrentBranch(repoRoot: string) {
  const branch = getCurrentBranch(repoRoot);
  if (!branch) throw new Error("Cannot push from a detached HEAD state");
  const upstream = runCommand(repoRoot, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    captureOutput: true,
    allowFailure: true,
  });
  if (upstream.status === 0 && upstream.stdout.trim().length > 0) {
    runCommand(repoRoot, "git", ["push"]);
    return branch;
  }
  runCommand(repoRoot, "git", ["push", "-u", "origin", "HEAD"]);
  return branch;
}
