import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  PRODUCTION_EPHEMERAL_KEYS,
  PRODUCTION_FORBIDDEN_KEYS,
  PRODUCTION_ENV_MIRROR_FILE,
  PRODUCTION_SENSITIVE_KEYS,
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

export interface VercelProductionEnvMetadata {
  key: string;
  type: string;
  target: string[];
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

export function listVercelProductionEnvMetadata(input: {
  cwd: string;
  spawn?: typeof spawnSync;
}): VercelProductionEnvMetadata[] {
  const spawn = input.spawn ?? spawnSync;
  const vercelBin = resolveVercelBin(input.cwd);
  const result = spawn(process.execPath, [
    vercelBin,
    "env",
    "list",
    "production",
    "--format",
    "json",
  ], {
    cwd: input.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new ProductionEnvError("Vercel production environment metadata lookup failed.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new ProductionEnvError("Vercel production environment metadata was invalid.");
  }
  const envs = (parsed as { envs?: unknown }).envs;
  if (
    !Array.isArray(envs) ||
    envs.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        typeof (item as { key?: unknown }).key !== "string" ||
        typeof (item as { type?: unknown }).type !== "string" ||
        !Array.isArray((item as { target?: unknown }).target) ||
        (item as { target: unknown[] }).target.some(
          (target) => typeof target !== "string",
        ),
    )
  ) {
    throw new ProductionEnvError("Vercel production environment metadata was invalid.");
  }
  return envs as VercelProductionEnvMetadata[];
}

export function validateVercelProductionEnvMetadata(
  envs: VercelProductionEnvMetadata[],
): void {
  for (const key of PRODUCTION_SENSITIVE_KEYS) {
    const matches = envs.filter((env) => env.key === key);
    if (
      matches.length !== 1 ||
      matches[0]?.type !== "sensitive" ||
      matches[0]?.target.length !== 1 ||
      matches[0]?.target[0] !== "production"
    ) {
      throw new ProductionEnvError(
        `Vercel production metadata is invalid for ${key}.`,
      );
    }
  }

  for (const key of PRODUCTION_FORBIDDEN_KEYS) {
    if (
      envs.some(
        (env) => env.key === key && env.target.includes("production"),
      )
    ) {
      throw new ProductionEnvError(`${key} is not allowed in production.`);
    }
  }
}

function sanitizePulledProductionEnv(stagingPath: string) {
  const contents = readFileSync(stagingPath, "utf8");
  const pulled = parseDotenv(contents);
  for (const key of PRODUCTION_SENSITIVE_KEYS) {
    if (Object.hasOwn(pulled, key) && pulled[key] !== "") {
      throw new ProductionEnvError(
        `${key} must not be readable from the production environment pull.`,
      );
    }
  }

  const omittedKeys = new Set<string>([
    ...PRODUCTION_SENSITIVE_KEYS,
    ...PRODUCTION_EPHEMERAL_KEYS,
  ]);
  const sanitized = contents
    .split(/\r?\n/)
    .filter((line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex < 1) return true;
      return !omittedKeys.has(line.slice(0, equalsIndex).trim());
    })
    .join("\n");
  writeFileSync(
    stagingPath,
    sanitized.endsWith("\n") ? sanitized : `${sanitized}\n`,
    "utf8",
  );
  return parseDotenv(sanitized);
}

export function pullProductionEnvMirror(input?: {
  cwd?: string;
  pull?: typeof pullVercelProductionEnvFile;
  list?: typeof listVercelProductionEnvMetadata;
}): string {
  const cwd = input?.cwd ?? process.cwd();
  const pull = input?.pull ?? pullVercelProductionEnvFile;
  const list = input?.list ?? listVercelProductionEnvMetadata;
  return withProductionEnvLock(cwd, () => {
    assertLinkedVercelProject(cwd);
    validateVercelProductionEnvMetadata(list({ cwd }));
    const dest = resolveCanonicalProductionEnvFile(cwd);
    assertNotSymlink(dest);
    const stagingPath = createStagingPath(cwd);
    try {
      pull({ cwd, destPath: stagingPath });
      assertNotSymlink(stagingPath);
      const parsed = sanitizePulledProductionEnv(stagingPath);
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
  list?: typeof listVercelProductionEnvMetadata;
}): ProductionEnvCheckResult {
  const cwd = input?.cwd ?? process.cwd();
  const pull = input?.pull ?? pullVercelProductionEnvFile;
  const list = input?.list ?? listVercelProductionEnvMetadata;
  return withProductionEnvLock(cwd, () => {
    assertLinkedVercelProject(cwd);
    validateVercelProductionEnvMetadata(list({ cwd }));
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
      const remote = sanitizePulledProductionEnv(stagingPath);
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
