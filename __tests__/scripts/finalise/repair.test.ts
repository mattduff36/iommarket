import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnSync } from "child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getFinaliseFailurePath, writeFinaliseFailureArtifact } from "../../../scripts/finalise/failure";

const roots: string[] = [];

function makeRepo() {
  const repoRoot = path.join(tmpdir(), `finalise-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      name: "repair-fixture",
      private: true,
      scripts: {
        typecheck: "node -e \"require('fs').writeFileSync('TYPECHECK_OK','ok')\"",
      },
    }),
    "utf8",
  );
  roots.push(repoRoot);
  return repoRoot;
}

function runRepair(repoRoot: string) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts", "finalise-repair.ts")],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );
}

afterEach(() => {
  for (const repoRoot of roots.splice(0)) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("targeted finalise repair", () => {
  it("reruns only the allowlisted failed step and clears the artifact", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });

    const result = runRepair(repoRoot);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(repoRoot, "TYPECHECK_OK"))).toBe(true);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
  }, 15_000);

  it("refuses a missing artifact", () => {
    const repoRoot = makeRepo();
    const result = runRepair(repoRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing or malformed/iu);
  });

  it("refuses a stale artifact", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    const filePath = getFinaliseFailurePath(repoRoot);
    const stale = JSON.parse(readFileSync(filePath, "utf8")) as { createdAt: string };
    stale.createdAt = "2020-01-01T00:00:00.000Z";
    writeFileSync(filePath, JSON.stringify(stale), "utf8");

    const result = runRepair(repoRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/stale/iu);
  });

  it("refuses a command that is not on the allowlist", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    const filePath = getFinaliseFailurePath(repoRoot);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { command: string };
    parsed.command = "rm -rf /";
    writeFileSync(filePath, JSON.stringify(parsed), "utf8");

    const result = runRepair(repoRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/allowlist/iu);
  });

  it("refuses when the safety fingerprint changed", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    const filePath = getFinaliseFailurePath(repoRoot);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { safetyFingerprint: string };
    parsed.safetyFingerprint = "changed";
    writeFileSync(filePath, JSON.stringify(parsed), "utf8");

    const result = runRepair(repoRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/safety fingerprint changed/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  });

  it("refuses after the targeted repair cycle is exceeded", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    const filePath = getFinaliseFailurePath(repoRoot);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { repairAttemptCount: number };
    parsed.repairAttemptCount = 2;
    writeFileSync(filePath, JSON.stringify(parsed), "utf8");

    const result = runRepair(repoRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/repair cycle exceeded/iu);
  });
});
