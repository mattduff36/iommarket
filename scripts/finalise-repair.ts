/**
 * Rerun only the last failed deterministic finalise step.
 * Does not repair commit, push, migrations, or unknown steps.
 */
import { spawnSync } from "child_process";
import {
  clearFinaliseFailureArtifact,
  getFinaliseFailurePath,
  getFinaliseSafetyFingerprint,
  incrementFinaliseRepairAttempt,
  readFinaliseFailureArtifact,
} from "./finalise/failure";
import { getFinaliseRepairCommand } from "./finalise/steps";

const REPO_ROOT = process.cwd();
const MAX_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000;

function fail(message: string): never {
  process.stderr.write(`finalise:repair refused: ${message}\n`);
  process.exit(1);
}

function main() {
  const artifact = readFinaliseFailureArtifact(REPO_ROOT);
  if (!artifact) {
    fail(`missing or malformed ${getFinaliseFailurePath(REPO_ROOT)}`);
  }
  const ageMs = Date.now() - Date.parse(artifact.createdAt);
  if (ageMs < 0 || ageMs > MAX_ARTIFACT_AGE_MS) {
    fail("failure artifact is stale");
  }
  const repair = getFinaliseRepairCommand(artifact.failedStep);
  if (!repair) {
    fail(`step ${artifact.failedStep} is not allowlisted`);
  }
  if (artifact.command !== repair.rendered) {
    fail("stored command does not match the hard-coded allowlist");
  }
  const currentSafety = getFinaliseSafetyFingerprint({
    repoRoot: REPO_ROOT,
    task: artifact.failedStep,
    mode: artifact.originalMode,
    command: repair.rendered,
  });
  if (currentSafety !== artifact.safetyFingerprint) {
    fail("toolchain/configuration safety fingerprint changed; rerun the original finalise command");
  }
  const attempted = incrementFinaliseRepairAttempt(REPO_ROOT);
  if ((attempted?.repairAttemptCount ?? 0) > 2) {
    fail("targeted repair cycle exceeded; rerun the original finalise command");
  }

  process.stdout.write(`Rerunning failed finalise step only: ${repair.rendered}\n`);
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", repair.args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  clearFinaliseFailureArtifact(REPO_ROOT);
  process.stdout.write("Targeted finalise repair passed. Run the original finalise command once for closure.\n");
}

main();
