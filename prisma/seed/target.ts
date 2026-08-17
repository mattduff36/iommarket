import { isCanonicalProductionEnvFile } from "@/lib/ops/production-env-file";
import { PRODUCTION_ENV_FILE_SUFFIX } from "./constants";

export interface SeedEnvLike {
  SEED_ALLOW?: string;
  SEED_TARGET?: string;
  SEED_ENV_FILE?: string;
  SEED_BACKUP_ID?: string;
  SEED_CONFIRM_DB?: string;
  SEED_WRITERS_PAUSED?: string;
}

export function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

export function parseDatabaseHost(connectionString: string | undefined) {
  if (!connectionString?.trim()) return null;
  try {
    return new URL(connectionString.trim()).hostname;
  } catch {
    return null;
  }
}

export function redactDatabaseTarget(connectionString: string | undefined) {
  if (!connectionString?.trim()) return null;
  try {
    const parsed = new URL(connectionString.trim());
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
    return `${parsed.hostname}/${database}`;
  } catch {
    return null;
  }
}

export function isProductionEnvFile(
  seedEnvFile: string | undefined,
  cwd = process.cwd(),
) {
  return isCanonicalProductionEnvFile(seedEnvFile, cwd);
}

export function isLiveSeedTarget(input: {
  seedTarget?: string;
  seedEnvFile?: string;
  databaseHost?: string | null;
  cwd?: string;
}) {
  if (input.seedTarget === "production") return true;
  if (isProductionEnvFile(input.seedEnvFile, input.cwd)) return true;
  if (input.databaseHost && !isLoopbackHost(input.databaseHost)) {
    return true;
  }
  return false;
}

export function assertSeedSafety(env: SeedEnvLike, input: {
  databaseHost?: string | null;
  redactedDatabase?: string | null;
  cwd?: string;
}) {
  if (env.SEED_ALLOW !== "1") {
    throw new Error("Refusing to seed without SEED_ALLOW=1.");
  }

  const live = isLiveSeedTarget({
    seedTarget: env.SEED_TARGET,
    seedEnvFile: env.SEED_ENV_FILE,
    databaseHost: input.databaseHost,
    cwd: input.cwd,
  });
  if (!live) return;

  if (env.SEED_TARGET !== "production") {
    throw new Error("Live database requires SEED_TARGET=production.");
  }
  if (!isProductionEnvFile(env.SEED_ENV_FILE, input.cwd)) {
    throw new Error(`Live database requires SEED_ENV_FILE=${PRODUCTION_ENV_FILE_SUFFIX}.`);
  }
  if (!env.SEED_BACKUP_ID?.trim()) {
    throw new Error("Live database requires SEED_BACKUP_ID.");
  }
  if (!input.redactedDatabase) {
    throw new Error("Live database confirmation target could not be parsed.");
  }
  if (env.SEED_CONFIRM_DB !== input.redactedDatabase) {
    throw new Error(
      `Live database requires SEED_CONFIRM_DB=${input.redactedDatabase}.`,
    );
  }
  if (env.SEED_WRITERS_PAUSED !== "1") {
    throw new Error("Live database requires SEED_WRITERS_PAUSED=1.");
  }
}
