import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "./git";

export class SubsetInventoryError extends Error {}
export type SuiteState = "passed" | "failed" | "skipped";
export type TestResult = { states: Record<string, SuiteState> };
export type TestRunner = (root: string, files?: string[]) => TestResult | undefined;

export const runTestFiles: TestRunner = (root, files) => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (scripts["test:run"] !== "vitest run" || scripts["pretest:run"] || scripts["posttest:run"]) {
    runCommand(root, "npm", ["run", "test:run"]);
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "finalise-vitest-"));
  const report = path.join(dir, "report.json");
  try {
    const states: Record<string, SuiteState> = {};
    // Windows has a 32K native command-line limit; never use shell interpolation.
    const chunks: string[][] = [[]];
    let length = 0;
    for (const file of files ?? []) {
      if (length + file.length > 20000) { chunks.push([]); length = 0; }
      chunks[chunks.length - 1].push(file);
      length += file.length + 3;
    }
    for (const chunk of chunks) {
      rmSync(report, { force: true });
      const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run",
        "--reporter=default", "--reporter=./scripts/finalise/test-run-reporter.mjs", ...chunk],
      { cwd: root, stdio: "inherit", env: { ...process.env, FINALISE_VITEST_REPORT: report } });
      if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
        throw result.error ?? new Error("Vitest did not finish normally");
      }
      let output;
      try { output = JSON.parse(readFileSync(report, "utf8")); }
      catch { throw new Error("Vitest did not report a complete, error-free suite inventory"); }
      const rows = Object.entries(output.states ?? {});
      const failed = rows.some(([, state]) => state === "failed");
      if (!rows.length || rows.some(([key, state]) => !["passed", "failed", "skipped"].includes(String(state)) || key in states) ||
          output.reason !== (failed ? "failed" : "passed") || result.status !== (failed ? 1 : 0) ||
          (files && (rows.length !== chunk.length || rows.some(([key]) => !chunk.includes(key))))) {
        if (files) {
          process.stdout.write("The targeted Vitest inventory could not be verified. Running the full suite.\n");
          throw new SubsetInventoryError("Targeted Vitest inventory mismatch");
        }
        throw new Error("Vitest exit status or file inventory did not match its report");
      }
      Object.assign(states, output.states);
    }
    return { states };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
