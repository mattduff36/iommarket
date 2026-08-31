import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearFinaliseFailureArtifact,
  getFinaliseFailurePath,
  incrementFinaliseRepairAttempt,
  readFinaliseFailureArtifact,
  writeFinaliseFailureArtifact,
} from "../../../scripts/finalise/failure";

const roots: string[] = [];

function makeRepo() {
  const repoRoot = path.join(tmpdir(), `finalise-failure-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(repoRoot, { recursive: true });
  roots.push(repoRoot);
  return repoRoot;
}

afterEach(() => {
  for (const repoRoot of roots.splice(0)) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("finalise failure artifact", () => {
  it("writes, reads, increments, and clears a valid artifact", () => {
    const repoRoot = makeRepo();
    const written = writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });

    expect(written.schemaVersion).toBe("1");
    expect(written.repairAttemptCount).toBe(0);
    expect(readFinaliseFailureArtifact(repoRoot)).toMatchObject({
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    expect(incrementFinaliseRepairAttempt(repoRoot)?.repairAttemptCount).toBe(1);
    clearFinaliseFailureArtifact(repoRoot);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
    expect(readFinaliseFailureArtifact(repoRoot)).toBeNull();
  });

  it("rejects unknown steps, including migrations", () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: "finalise",
      failedStep: "typecheck",
      command: "npm run typecheck",
    });
    const filePath = getFinaliseFailurePath(repoRoot);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    parsed.failedStep = "migrations";
    writeFileSync(filePath, JSON.stringify(parsed), "utf8");
    expect(readFinaliseFailureArtifact(repoRoot)).toBeNull();
  });

  it("rejects a malformed artifact", () => {
    const repoRoot = makeRepo();
    const filePath = getFinaliseFailurePath(repoRoot);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{not-json", "utf8");
    expect(readFinaliseFailureArtifact(repoRoot)).toBeNull();
  });
});
