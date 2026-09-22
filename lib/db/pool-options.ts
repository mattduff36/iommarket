import type { PoolConfig } from "pg";
import type { RuntimeEnv } from "@/lib/runtime-env";

const DATABASE_POOL_MAX = 5;
const CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

export function sanitiseConnectionString(raw: string): string {
  let url = raw.trim();

  // Strip params that conflict with the explicit TLS options below.
  // pg v8+ treats sslmode=require as verify-full and can override ssl.ca.
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    url = parsed.toString();
  } catch {
    // Keep a non-URL connection string unchanged.
  }

  return url;
}

export function readDatabaseCaCertificate(env: RuntimeEnv = process.env): string | null {
  const raw = env.SUPABASE_DB_CA_CERT?.trim();
  if (!raw) return null;
  const certificate = raw.replace(/\\n/g, "\n");
  if (!CERTIFICATE_PATTERN.test(certificate)) {
    throw new Error("SUPABASE_DB_CA_CERT is invalid");
  }
  return certificate;
}

function connectionHost(connectionString: string): string {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function databaseTlsMustBeVerified(
  connectionString: string,
  env: RuntimeEnv = process.env,
): boolean {
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return true;
  if (env.NODE_ENV === "production") return true;
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return false;
  const host = connectionHost(connectionString);
  return host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
}

export function buildDatabasePoolOptions(
  rawUrl: string,
  env: RuntimeEnv = process.env,
): PoolConfig {
  const connectionString = sanitiseConnectionString(rawUrl);
  const certificate = readDatabaseCaCertificate(env);
  if (databaseTlsMustBeVerified(connectionString, env) && !certificate) {
    throw new Error("SUPABASE_DB_CA_CERT is required for verified database TLS");
  }

  return {
    connectionString,
    ssl: certificate
      ? { ca: certificate, rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    max: DATABASE_POOL_MAX,
  };
}

export function databaseSslOptions(
  connectionString: string,
  env: RuntimeEnv = process.env,
): PoolConfig["ssl"] {
  return buildDatabasePoolOptions(connectionString, env).ssl;
}
