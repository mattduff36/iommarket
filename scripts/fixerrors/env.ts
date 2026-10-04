import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "../wipe-preview-marketplace/target";

export const FIXERRORS_DATABASE_TARGETS = ["production", "preview", "staging", "development"] as const;
export type FixerrorsDatabaseTarget = (typeof FIXERRORS_DATABASE_TARGETS)[number];

const TARGET_ENV_FILES: Record<FixerrorsDatabaseTarget, string> = {
  production: ".env.production",
  preview: ".env.local",
  staging: ".env.staging",
  development: ".env.development",
};

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(readFileSync(filePath, "utf8")))) {
    if (value !== undefined) values[key] = value;
  }
  return values;
}

export function parseFixerrorsDatabaseTarget(value: string | null | undefined): FixerrorsDatabaseTarget {
  const normalized = (value ?? "production").trim().toLowerCase();
  const target = normalized === "dev" ? "development" : normalized;
  if (target === "production" || target === "preview" || target === "staging" || target === "development") {
    return target;
  }
  throw new Error("fixerrors --database must be production, preview, staging, or development");
}

export function assertFixerrorsDatabaseUrl(target: FixerrorsDatabaseTarget, connectionString: string): void {
  const identity = databaseIdentity(connectionString);
  const production = identity.includes(PRODUCTION_PROJECT_REF);
  const preview = identity.includes(PREVIEW_PROJECT_REF);
  if (target === "production") {
    if (!production || preview) {
      throw new Error("Refusing fixerrors: production target must use the production database.");
    }
    return;
  }
  if (production) {
    throw new Error(`Refusing fixerrors: ${target} target must not use the production database.`);
  }
  if ((target === "preview" || target === "staging") && !preview) {
    throw new Error(`Refusing fixerrors: ${target} target must use the preview database.`);
  }
}

export function loadFixerrorsDatabase(
  target: FixerrorsDatabaseTarget = "production",
  cwd = process.cwd(),
): { target: FixerrorsDatabaseTarget; envFile: string; connectionString: string; host: string } {
  const envFile = TARGET_ENV_FILES[target];
  const values = parseEnvFile(resolve(cwd, envFile));
  const connectionString = values.POSTGRES_URL_NON_POOLING?.trim();
  if (!connectionString) {
    throw new Error(`${envFile} must define POSTGRES_URL_NON_POOLING for the ${target} database`);
  }
  assertFixerrorsDatabaseUrl(target, connectionString);
  process.env.POSTGRES_URL_NON_POOLING = connectionString;
  const certificate = values.SUPABASE_DB_CA_CERT ?? readFallbackCertificate(cwd);
  if (certificate) process.env.SUPABASE_DB_CA_CERT = certificate;
  return {
    target,
    envFile,
    connectionString,
    host: new URL(connectionString).hostname,
  };
}

function databaseIdentity(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Refusing fixerrors: POSTGRES_URL_NON_POOLING could not be parsed.");
  }
  return `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.toLowerCase();
}

function readFallbackCertificate(cwd: string): string | undefined {
  for (const file of [".env", ".env.local"]) {
    const certificate = parseEnvFile(resolve(cwd, file)).SUPABASE_DB_CA_CERT;
    if (certificate) return certificate;
  }
  return undefined;
}

export function requireNonPoolingConnectionString(
  env: Record<string, string | undefined> = process.env,
): string {
  const connectionString = env.POSTGRES_URL_NON_POOLING?.trim();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING is required for transaction-safe fixerrors execution",
    );
  }
  return connectionString;
}

export function sanitiseConnectionString(raw: string): string {
  let url = raw.trim();
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    url = parsed.toString();
  } catch {
    // Keep the original string when it is not a URL.
  }
  return url;
}

export function createDatabaseTargetFingerprint(connectionString: string): string {
  const parsed = new URL(sanitiseConnectionString(connectionString));
  const target = [
    parsed.protocol,
    parsed.hostname,
    parsed.port || "5432",
    parsed.pathname.replace(/^\/+/u, "") || "postgres",
  ].join("|");
  return createHash("sha256").update(target).digest("hex");
}
