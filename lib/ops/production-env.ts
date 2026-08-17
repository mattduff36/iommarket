import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  PRODUCTION_ENV_MIRROR_FILE,
} from "@/lib/ops/production-env-contract";
import {
  assertLinkedVercelProject,
  assertNotSymlink,
  compareEnvMaps,
  createStagingPath,
  formatEnvDrift,
  parseDotenv,
  ProductionEnvError,
  replaceProductionEnvMirror,
  resolveCanonicalProductionEnvFile,
  validateProductionEnv,
  withProductionEnvLock,
  type EnvDrift,
} from "@/lib/ops/production-env-file";

export interface ProductionEnvCheckResult {
  ok: boolean;
  drift: EnvDrift;
}

function resolveVercelBin(cwd: string): string {
  const require = createRequire(path.join(cwd, "package.json"));
  const packageJsonPath = require.resolve("vercel/package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin =
    typeof pkg.bin === "string"
      ? pkg.bin
      : pkg.bin?.vercel ?? pkg.bin?.vc;
  if (!bin) {
    throw new ProductionEnvError("Pinned Vercel CLI binary was not found.");
  }
  return path.resolve(path.dirname(packageJsonPath), bin);
}

export function pullVercelProductionEnvFile(input: {
  cwd: string;
  destPath: string;
  spawn?: typeof spawnSync;
}): void {
  const spawn = input.spawn ?? spawnSync;
  const vercelBin = resolveVercelBin(input.cwd);
  const result = spawn(process.execPath, [
    vercelBin,
    "env",
    "pull",
    input.destPath,
    "--environment=production",
    "--yes",
  ], {
    cwd: input.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new ProductionEnvError("Vercel production environment pull failed.");
  }
}

export function pullProductionEnvMirror(input?: {
  cwd?: string;
  pull?: typeof pullVercelProductionEnvFile;
}): string {
  const cwd = input?.cwd ?? process.cwd();
  const pull = input?.pull ?? pullVercelProductionEnvFile;
  return withProductionEnvLock(cwd, () => {
    assertLinkedVercelProject(cwd);
    const dest = resolveCanonicalProductionEnvFile(cwd);
    assertNotSymlink(dest);
    const stagingPath = createStagingPath(cwd);
    try {
      pull({ cwd, destPath: stagingPath });
      assertNotSymlink(stagingPath);
      const parsed = parseDotenv(readFileSync(stagingPath, "utf8"));
      validateProductionEnv(parsed);
      replaceProductionEnvMirror({ cwd, stagingPath });
      return dest;
    } catch (error) {
      rmSync(stagingPath, { force: true });
      throw error;
    }
  });
}

export function checkProductionEnvMirror(input?: {
  cwd?: string;
  pull?: typeof pullVercelProductionEnvFile;
}): ProductionEnvCheckResult {
  const cwd = input?.cwd ?? process.cwd();
  const pull = input?.pull ?? pullVercelProductionEnvFile;
  return withProductionEnvLock(cwd, () => {
    assertLinkedVercelProject(cwd);
    const dest = resolveCanonicalProductionEnvFile(cwd);
    if (!existsSync(dest)) {
      throw new ProductionEnvError(`${PRODUCTION_ENV_MIRROR_FILE} is missing.`);
    }
    assertNotSymlink(dest);
    const local = parseDotenv(readFileSync(dest, "utf8"));
    validateProductionEnv(local);
    const stagingPath = createStagingPath(cwd);
    try {
      pull({ cwd, destPath: stagingPath });
      assertNotSymlink(stagingPath);
      const remote = parseDotenv(readFileSync(stagingPath, "utf8"));
      validateProductionEnv(remote);
      const drift = compareEnvMaps(local, remote);
      return {
        ok:
          drift.missing.length === 0 &&
          drift.extra.length === 0 &&
          drift.mismatched.length === 0,
        drift,
      };
    } finally {
      rmSync(stagingPath, { force: true });
    }
  });
}

export function assertProductionEnvMirrorCurrent(input?: {
  cwd?: string;
  check?: typeof checkProductionEnvMirror;
}): void {
  const result = (input?.check ?? checkProductionEnvMirror)({ cwd: input?.cwd });
  if (!result.ok) {
    throw new ProductionEnvError(
      `Production environment mirror is out of date (${formatEnvDrift(result.drift)}).`,
    );
  }
}
