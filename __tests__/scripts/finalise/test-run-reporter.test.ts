import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import Reporter from "../../../scripts/finalise/test-run-reporter.mjs";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function collect(files: [string, string][], errors: string[] = [], reason = "failed") {
  const dir = mkdtempSync(path.join(tmpdir(), "finalise-report-"));
  scratch.push(dir);
  const report = path.join(dir, "result.json");
  vi.stubEnv("FINALISE_VITEST_REPORT", report);
  const reporter = new Reporter();
  const moduleId = (name: string) => path.resolve(name);
  reporter.onTestRunStart(["a", "b"].map(name => ({ moduleId: moduleId(name) })));
  reporter.onTestRunEnd(files.map(([name, state]) => ({ moduleId: moduleId(name), state: () => state })), errors, reason);
  return existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
}

it("retains both passing and failing modules from a completed run", () => {
  expect(collect([["a", "passed"], ["b", "failed"]])).toEqual({ states: { a: "passed", b: "failed" }, reason: "failed" });
});
it("rejects interrupted, incomplete, duplicate, unhandled and unfinished inventories", () => {
  expect(collect([["a", "passed"]])).toBeNull();
  expect(collect([["a", "passed"], ["a", "failed"]])).toBeNull();
  expect(collect([["a", "passed"], ["b", "pending"]])).toBeNull();
  expect(collect([["a", "passed"], ["b", "failed"]], [], "interrupted")).toBeNull();
  expect(collect([["a", "passed"], ["b", "passed"]], ["worker crashed"])).toBeNull();
});
