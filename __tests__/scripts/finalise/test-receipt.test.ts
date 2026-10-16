import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVerifiedTests } from "../../../scripts/finalise/test-receipt";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "finalise-receipt-")); roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(path.join(root, "code.ts"), "original");
  writeFileSync(path.join(root, ".gitignore"), ".env*\n");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("finalise test receipts", () => {
  it("reuses identical successful inputs", () => {
    const root = fixture(); const run = vi.fn(); runVerifiedTests(root, run); runVerifiedTests(root, run); expect(run).toHaveBeenCalledTimes(1);
  });
  it.each(["code.ts", "new-test.ts", "package-lock.json", ".env.local"])("reruns when %s changes", (file) => {
    const root = fixture(); const run = vi.fn(); runVerifiedTests(root, run);
    writeFileSync(path.join(root, file), "changed"); runVerifiedTests(root, run); expect(run).toHaveBeenCalledTimes(2);
  });
  it("does not reuse failures", () => {
    const root = fixture(); expect(() => runVerifiedTests(root, () => { throw new Error("failed"); })).toThrow("failed");
    const run = vi.fn(); runVerifiedTests(root, run); expect(run).toHaveBeenCalledOnce();
  });
  it("does not certify files changed during the run", () => {
    const root = fixture(); runVerifiedTests(root, () => writeFileSync(path.join(root, "code.ts"), "changed"));
    const run = vi.fn(); runVerifiedTests(root, run); expect(run).toHaveBeenCalledOnce();
  });
  it("rejects stale receipts", () => {
    const root = fixture(); const run = vi.fn(); runVerifiedTests(root, run); runVerifiedTests(root, run, Date.now() + 86400001); expect(run).toHaveBeenCalledTimes(2);
  });
  it("invalidates on environment changes and supports explicit fresh runs", () => {
    const root = fixture(); const run = vi.fn(); runVerifiedTests(root, run);
    vi.stubEnv("FINALISE_RECEIPT_TEST_INPUT", "changed"); runVerifiedTests(root, run);
    vi.stubEnv("FINALISE_FORCE_TESTS", "1"); runVerifiedTests(root, run); expect(run).toHaveBeenCalledTimes(3);
  });
});
