import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(readFileSync(filePath, "utf8")))) {
    if (value !== undefined) values[key] = value;
  }
  return values;
}

export function loadFixerrorsEnv(cwd = process.cwd()): void {
  const files = [resolve(cwd, ".env"), resolve(cwd, ".env.local")];
  for (const file of files) {
    for (const [key, value] of Object.entries(parseEnvFile(file))) {
      process.env[key] = value;
    }
  }
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
