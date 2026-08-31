import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

function runFinalise(args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts", "finalise.ts"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );
}

describe("finalise CLI", () => {
  it("prints help without running checks", () => {
    const result = runFinalise(["--help"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/never applies migrations/iu);
    expect(result.stdout).not.toMatch(/Starting finalise workflow/u);
  });

  it("dry-run reports no database mutations and does not commit", () => {
    const result = runFinalise(["--dry-run"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Trusted action: finalise \(iommarket-finalise-v1\)/u);
    expect(result.stdout).toMatch(/Database mutations: none/u);
    expect(result.stdout).toMatch(/Verify: npm run typecheck, npm run test:run/u);
    expect(result.stdout).toMatch(/Push: skipped/u);
    expect(result.stdout).not.toMatch(/Created commit/u);
  });

  it("full dry-run includes lint and build", () => {
    const result = runFinalise(["--full", "--dry-run"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Trusted action: finalise-full \(iommarket-finalise-v1\)/u);
    expect(result.stdout).toMatch(/Verify: npm run typecheck, npm run test:run, npm run lint, npm run build/u);
  });
});
