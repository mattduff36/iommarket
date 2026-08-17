import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import {
  PRODUCTION_BOOLEAN_KEYS,
  PRODUCTION_ENV_LOCK_FILE,
  PRODUCTION_ENV_MIRROR_FILE,
  PRODUCTION_ENV_STAGING_PREFIX,
  PRODUCTION_EXACT_VALUES,
  PRODUCTION_FORBIDDEN_KEYS,
  PRODUCTION_REQUIRED_KEYS,
  PRODUCTION_URL_KEYS,
  PRODUCTION_VERCEL_PROJECT_ID,
  PRODUCTION_VERCEL_TEAM_ID,
  isPlaceholderEnvValue,
} from "@/lib/ops/production-env-contract";

export class ProductionEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionEnvError";
  }
}

export interface EnvMap {
  [key: string]: string;
}

export interface EnvDrift {
  missing: string[];
  extra: string[];
  mismatched: string[];
}

export function resolveCanonicalProductionEnvFile(cwd = process.cwd()): string {
  return path.normalize(path.resolve(cwd, PRODUCTION_ENV_MIRROR_FILE));
}

export function isCanonicalProductionEnvFile(
  seedEnvFile: string | undefined,
  cwd = process.cwd(),
): boolean {
  if (!seedEnvFile) return false;
  return (
    path.normalize(path.resolve(cwd, seedEnvFile)) ===
    resolveCanonicalProductionEnvFile(cwd)
  );
}

export function assertNotSymlink(filePath: string): void {
  if (!existsSync(filePath)) return;
  if (lstatSync(filePath).isSymbolicLink()) {
    throw new ProductionEnvError("Refusing to use a symlinked environment file.");
  }
}

export function parseDotenv(contents: string): EnvMap {
  const values: EnvMap = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      throw new ProductionEnvError(`Invalid environment line ${index + 1}.`);
    }
    const key = line.slice(0, eqIdx).trim();
    if (!key) {
      throw new ProductionEnvError(`Invalid environment line ${index + 1}.`);
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new ProductionEnvError(`Duplicate environment key ${key}.`);
    }
    let value = line.slice(eqIdx + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function compareEnvMaps(left: EnvMap, right: EnvMap): EnvDrift {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  const missing = rightKeys.filter((key) => !Object.hasOwn(left, key));
  const extra = leftKeys.filter((key) => !Object.hasOwn(right, key));
  const mismatched = leftKeys.filter(
    (key) => Object.hasOwn(right, key) && left[key] !== right[key],
  );
  return { missing, extra, mismatched };
}

export function formatEnvDrift(drift: EnvDrift): string {
  const parts: string[] = [];
  if (drift.missing.length) parts.push(`missing: ${drift.missing.join(", ")}`);
  if (drift.extra.length) parts.push(`extra: ${drift.extra.join(", ")}`);
  if (drift.mismatched.length) parts.push(`mismatched: ${drift.mismatched.join(", ")}`);
  return parts.join("; ") || "no drift";
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function assertProductionUrl(key: string, value: string): void {
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new ProductionEnvError(`Invalid production URL for ${key}.`);
  }
  if (isLoopbackHost(hostname)) {
    throw new ProductionEnvError(`Loopback production URL is not allowed for ${key}.`);
  }
}

export function validateProductionEnv(values: EnvMap): void {
  for (const key of PRODUCTION_REQUIRED_KEYS) {
    if (!Object.hasOwn(values, key)) {
      throw new ProductionEnvError(`Missing required production key ${key}.`);
    }
    if (isPlaceholderEnvValue(values[key] ?? "")) {
      throw new ProductionEnvError(`Placeholder production value for ${key}.`);
    }
  }

  for (const key of PRODUCTION_FORBIDDEN_KEYS) {
    if (Object.hasOwn(values, key)) {
      throw new ProductionEnvError(`${key} is not allowed in production.`);
    }
  }

  for (const [key, expected] of Object.entries(PRODUCTION_EXACT_VALUES)) {
    if (values[key] !== expected) {
      throw new ProductionEnvError(`Unexpected production value for ${key}.`);
    }
  }

  for (const key of PRODUCTION_BOOLEAN_KEYS) {
    if (values[key] !== "true" && values[key] !== "false") {
      throw new ProductionEnvError(`${key} must be exactly true or false.`);
    }
  }

  for (const key of PRODUCTION_URL_KEYS) {
    assertProductionUrl(key, values[key] ?? "");
  }
}

export function readLinkedVercelProject(cwd = process.cwd()): {
  projectId: string;
  orgId: string;
} {
  const projectPath = path.resolve(cwd, ".vercel", "project.json");
  if (!existsSync(projectPath)) {
    throw new ProductionEnvError("Vercel project is not linked.");
  }
  const parsed = JSON.parse(readFileSync(projectPath, "utf8")) as {
    projectId?: string;
    orgId?: string;
  };
  if (!parsed.projectId || !parsed.orgId) {
    throw new ProductionEnvError("Vercel project link is incomplete.");
  }
  return { projectId: parsed.projectId, orgId: parsed.orgId };
}

export function assertLinkedVercelProject(cwd = process.cwd()): void {
  const linked = readLinkedVercelProject(cwd);
  if (
    linked.projectId !== PRODUCTION_VERCEL_PROJECT_ID ||
    linked.orgId !== PRODUCTION_VERCEL_TEAM_ID
  ) {
    throw new ProductionEnvError("Linked Vercel project does not match the production contract.");
  }
}

export function createStagingPath(cwd = process.cwd()): string {
  return path.resolve(
    cwd,
    `${PRODUCTION_ENV_STAGING_PREFIX}${randomBytes(8).toString("hex")}`,
  );
}

export function cleanStaleStagingFiles(cwd = process.cwd()): void {
  const directory = path.resolve(cwd);
  const entries = existsSync(directory) ? readdirSync(directory) : [];
  for (const entry of entries) {
    if (!entry.startsWith(PRODUCTION_ENV_STAGING_PREFIX)) continue;
    const target = path.resolve(directory, entry);
    assertNotSymlink(target);
    rmSync(target, { force: true });
  }
}

export function withProductionEnvLock<T>(cwd: string, fn: () => T): T {
  const lockPath = path.resolve(cwd, PRODUCTION_ENV_LOCK_FILE);
  mkdirSync(cwd, { recursive: true });
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch {
    throw new ProductionEnvError("Another production environment command is already running.");
  }
  try {
    cleanStaleStagingFiles(cwd);
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort lock cleanup.
    }
  }
}

export function replaceProductionEnvMirror(input: {
  cwd?: string;
  stagingPath: string;
  platform?: NodeJS.Platform;
  rename?: typeof renameSync;
  copyFile?: typeof copyFileSync;
}): void {
  const cwd = input.cwd ?? process.cwd();
  const dest = resolveCanonicalProductionEnvFile(cwd);
  const platform = input.platform ?? process.platform;
  const rename = input.rename ?? renameSync;
  const copyFile = input.copyFile ?? copyFileSync;
  assertNotSymlink(dest);
  assertNotSymlink(input.stagingPath);
  if (!existsSync(input.stagingPath)) {
    throw new ProductionEnvError("Production environment staging file is missing.");
  }
  try {
    try {
      rename(input.stagingPath, dest);
    } catch (error) {
      if (platform !== "win32") {
        throw error;
      }
      copyFile(input.stagingPath, dest);
      unlinkSync(input.stagingPath);
    }
    try {
      chmodSync(dest, 0o600);
    } catch {
      // Windows cannot honor POSIX mode bits.
    }
    const fd = openSync(dest, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    throw error instanceof ProductionEnvError
      ? error
      : new ProductionEnvError("Failed to replace the production environment mirror.");
  }
}
