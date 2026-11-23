import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { affectedTestFiles } from "./test-dependencies";
import { runTestFiles, SubsetInventoryError, type SuiteState, type TestRunner } from "./test-runner";

const MAX_AGE = 24 * 60 * 60 * 1000;
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
type Inputs = { context: string; files: Record<string, string> };
type Receipt = { version: 2; inputs: Inputs; states: Record<string, SuiteState>; completedAt: number };

function snapshot(root: string): Inputs | null {
  try {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
    files.push(...readdirSync(root).filter(name => name.startsWith(".env")), "node_modules/.package-lock.json");
    const env = Object.entries(process.env).filter(([key]) => !/^(npm_lifecycle_event|npm_lifecycle_script|npm_command|INIT_CWD|SKIP_CURSOR_USAGE|FINALISE_FORCE_TESTS|_)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
    const context = digest(JSON.stringify([path.resolve(root), process.version, process.platform, process.arch, env]));
    const entries: Record<string, string> = Object.create(null);
    for (const file of [...new Set(files)].sort()) {
      const absolute = path.join(root, file);
      if (!existsSync(absolute)) { entries[file] = "missing"; continue; }
      const stat = lstatSync(absolute);
      if (!stat.isFile()) return null;
      entries[file] = stat.mode + ":" + digest(readFileSync(absolute));
    }
    return { context, files: entries };
  } catch { return null; }
}

function readReceipt(file: string, now: number): Receipt | undefined {
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    const r = record.receipt;
    if (digest(JSON.stringify(r)) !== record.digest || r?.version !== 2 || !Number.isFinite(r.completedAt) ||
      now < r.completedAt || now - r.completedAt >= MAX_AGE || !r.inputs?.files || typeof r.inputs.context !== "string" ||
      !r.states || !Object.keys(r.states).length || !Object.values(r.states).every(s => s === "passed" || s === "failed" || s === "skipped")) return;
    return r;
  } catch { return; }
}

function needed(root: string, before: Inputs, previous: Receipt): string[] | undefined {
  if (before.context !== previous.inputs.context) return;
  const old = previous.inputs.files;
  const names = Object.keys(before.files);
  if (names.length !== Object.keys(old).length || names.some(name => !Object.hasOwn(old, name))) return;
  const changed = names.filter(name => before.files[name] !== old[name]);
  if (changed.some(name => before.files[name] === "missing" || old[name] === "missing")) return;
  const affected = changed.length ? affectedTestFiles(root, Object.keys(previous.states), changed) : [];
  if (!affected) return;
  return [...new Set([...affected, ...Object.keys(previous.states).filter(file => previous.states[file] === "failed")])];
}

export function runVerifiedTests(root: string, run: TestRunner = runTestFiles, now = Date.now()) {
  let file: string;
  try { file = path.resolve(root, execFileSync("git", ["rev-parse", "--git-path", "finalise-test-success.json"], {cwd: root, encoding: "utf8"}).trim()); }
  catch { const result = run(root); if (result && Object.values(result.states).includes("failed")) throw new Error("Vitest failed"); return; }
  const before = snapshot(root);
  const prior = process.env.FINALISE_FORCE_TESTS === "1" ? undefined : readReceipt(file, now);
  const selected = before && prior ? needed(root, before, prior) : undefined;
  if (selected && !selected.length && JSON.stringify(before) === JSON.stringify(prior!.inputs)) {
    process.stdout.write("Reusing verified Vitest results for identical inputs.\n"); return;
  }
  // Keep at least one actual verification on changed inputs even if no known test imports them.
  let subset = selected?.length && prior && selected.length < Object.keys(prior.states).length ? selected : undefined;
  if (subset) process.stdout.write(`Rerunning ${subset.length} failed, affected or unclassified Vitest files of ${Object.keys(prior!.states).length}.\n`);
  rmSync(file, { force: true });
  let result;
  try { result = run(root, subset); }
  catch (error) {
    if (!(error instanceof SubsetInventoryError) || !subset) throw error;
    subset = undefined;
    result = run(root);
  }
  if (!result) return; // The fallback package script completed without per-file evidence.
  const states = { ...(subset && prior ? prior.states : {}), ...result.states };
  if (subset && (Object.keys(result.states).length !== subset.length || subset.some(name => !Object.hasOwn(result.states, name)))) {
    throw new Error("Incomplete targeted test results");
  }
  if (before && JSON.stringify(before) === JSON.stringify(snapshot(root))) {
    const receipt: Receipt = { version: 2, inputs: before, states, completedAt: subset ? prior!.completedAt : now };
    const temp = file + "." + randomUUID();
    try {
      writeFileSync(temp, JSON.stringify({receipt, digest: digest(JSON.stringify(receipt))}));
      renameSync(temp, file);
    } finally { rmSync(temp, { force: true }); }
  } else if (before) { throw new Error("Test inputs changed during verification; rerun finalise"); }
  if (Object.values(states).includes("failed")) throw new Error("Vitest reported failing test files");
}
