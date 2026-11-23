import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVerifiedTests } from "../../../scripts/finalise/test-receipt";
import type { TestRunner } from "../../../scripts/finalise/test-runner";

const roots: string[] = [];
const pure = "__tests__/pure.test.ts";
const usesCode = "__tests__/code.test.ts";
const raw = "__tests__/reads.test.ts";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "finalise-receipt-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(path.join(root, "__tests__"));
  mkdirSync(path.join(root, "lib"));
  const write = (file: string, value: string) => writeFileSync(path.join(root, file), value);
  for (const file of ["vitest.config.ts", "vitest.setup.ts", "vitest.globals-shim.ts", "tsconfig.json"]) {
    copyFileSync(path.join(process.cwd(), file), path.join(root, file));
  }
  write(".gitignore", ".env*\n");
  write(pure, 'import { test } from "vitest"; test("pure", () => {});');
  write(usesCode, 'import { value } from "@/lib/helpers";');
  write("lib/helpers.ts", 'export { value } from "./code";');
  write("lib/code.ts", "export const value = 1;");
  write(raw, 'import { readFileSync } from "node:fs";');
  let failure: string | null = null;
  const run = vi.fn<TestRunner>((_, files = [pure, usesCode, raw]) => ({
    states: Object.fromEntries(files.map(file => [file, file === failure ? "failed" : "passed"])),
  }));
  return { root, run, write, fail: (file: string | null) => { failure = file; } };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("finalise file receipts", () => {
  it("reuses identical successful inputs", () => {
    const { root, run } = fixture();
    runVerifiedTests(root, run); runVerifiedTests(root, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("reruns only failures when unchanged and reuses the repaired result for closure", () => {
    const { root, run, fail } = fixture();
    fail(usesCode); expect(() => runVerifiedTests(root, run)).toThrow(/failing/);
    fail(null); runVerifiedTests(root, run); runVerifiedTests(root, run);
    expect(run.mock.calls).toEqual([[root, undefined], [root, [usesCode]]]);
  });
  it.each(["lib/code.ts", usesCode])("includes failed, dependent and opaque files after edits to %s", file => {
    const { root, run, fail, write } = fixture();
    fail(usesCode); expect(() => runVerifiedTests(root, run)).toThrow();
    write(file, "export const value = 2;"); fail(null); runVerifiedTests(root, run);
    expect(run.mock.calls[1][1]?.sort()).toEqual([usesCode, raw].sort());
  });
  it.each(["new-test.ts", "package-lock.json", ".env.local"])("does a full run after changing %s", file => {
    const { root, run, write } = fixture(); runVerifiedTests(root, run);
    write(file, "changed"); runVerifiedTests(root, run);
    expect(run).toHaveBeenLastCalledWith(root, undefined);
  });
  it("falls back to a full run when global setup loads an application module", () => {
    const { root, run, write } = fixture();
    write("vitest.setup.ts", 'import "./lib/code";'); runVerifiedTests(root, run);
    write("lib/code.ts", "changed"); runVerifiedTests(root, run);
    expect(run).toHaveBeenLastCalledWith(root, undefined);
  });
  it("forces full verification for stale receipts, environment changes and explicit fresh runs", () => {
    const { root, run } = fixture(); const now = Date.now(); runVerifiedTests(root, run, now);
    runVerifiedTests(root, run, now + 86400001);
    vi.stubEnv("FINALISE_RECEIPT_TEST_INPUT", "changed"); runVerifiedTests(root, run);
    vi.stubEnv("FINALISE_FORCE_TESTS", "1"); runVerifiedTests(root, run);
    expect(run.mock.calls).toEqual(Array(4).fill([root, undefined]));
  });
  it("rejects incomplete targeted reports and excludes interrupted and unstable results", () => {
    const { root, run, fail, write } = fixture();
    fail(raw); expect(() => runVerifiedTests(root, run)).toThrow();
    expect(() => runVerifiedTests(root, () => ({ states: {} }))).toThrow(/Incomplete/);
    expect(() => runVerifiedTests(root, () => { throw new Error("interrupted"); })).toThrow("interrupted");
    expect(() => runVerifiedTests(root, () => {
      write("lib/code.ts", "changed"); return { states: { [raw]: "passed" } };
    })).toThrow(/inputs changed/);
    fail(null); runVerifiedTests(root, run); expect(run).toHaveBeenLastCalledWith(root, undefined);
  });
  it("rejects damaged receipts", () => {
    const { root, run } = fixture(); runVerifiedTests(root, run);
    const file = path.join(root, ".git/finalise-test-success.json");
    const stored = JSON.parse(readFileSync(file, "utf8")); stored.receipt.states = {};
    writeFileSync(file, JSON.stringify(stored)); runVerifiedTests(root, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
