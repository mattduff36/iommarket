import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import type { FinaliseModeKey, FinaliseTaskKey } from "./types";

export interface FinaliseFailureArtifact {
  schemaVersion: "1";
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey;
  command: string;
  safetyFingerprint: string;
  createdAt: string;
  repairAttemptCount: number;
}

export function getFinaliseFailurePath(repoRoot: string) {
  return path.join(repoRoot, "private", "automation", "finalise-last-failure.json");
}

export function getFinaliseSafetyFingerprint(input: {
  repoRoot: string;
  task: FinaliseTaskKey;
  mode: FinaliseModeKey;
  command: string;
}) {
  return createHash("sha256")
    .update([process.version, input.mode, input.task, input.command, input.repoRoot].join("\n"))
    .digest("hex");
}

export function writeFinaliseFailureArtifact(params: {
  repoRoot: string;
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey;
  command: string;
}): FinaliseFailureArtifact {
  const artifact: FinaliseFailureArtifact = {
    schemaVersion: "1",
    originalMode: params.originalMode,
    failedStep: params.failedStep,
    command: params.command,
    safetyFingerprint: getFinaliseSafetyFingerprint({
      repoRoot: params.repoRoot,
      task: params.failedStep,
      mode: params.originalMode,
      command: params.command,
    }),
    createdAt: new Date().toISOString(),
    repairAttemptCount: 0,
  };
  const filePath = getFinaliseFailurePath(params.repoRoot);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export function readFinaliseFailureArtifact(repoRoot: string): FinaliseFailureArtifact | null {
  const filePath = getFinaliseFailurePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as FinaliseFailureArtifact;
    if (
      parsed.schemaVersion !== "1" ||
      !["finalise", "finalise-full", "fap", "ffap"].includes(parsed.originalMode) ||
      !["typecheck", "test-run", "lint", "build"].includes(parsed.failedStep) ||
      typeof parsed.command !== "string" ||
      typeof parsed.safetyFingerprint !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      return null;
    }
    return { ...parsed, repairAttemptCount: parsed.repairAttemptCount ?? 0 };
  } catch {
    return null;
  }
}

export function incrementFinaliseRepairAttempt(repoRoot: string) {
  const artifact = readFinaliseFailureArtifact(repoRoot);
  if (!artifact) return null;
  const next = { ...artifact, repairAttemptCount: artifact.repairAttemptCount + 1 };
  writeFileSync(getFinaliseFailurePath(repoRoot), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function clearFinaliseFailureArtifact(repoRoot: string) {
  rmSync(getFinaliseFailurePath(repoRoot), { force: true });
}
