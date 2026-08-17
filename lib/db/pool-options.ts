import type { PoolConfig } from "pg";

const DATABASE_POOL_MAX = 5;

export function sanitiseConnectionString(raw: string): string {
  // Trim whitespace / stray newlines that break pg connection strings
  let url = raw.trim();

  // Strip params that conflict with our explicit Pool options:
  // - sslmode: pg v8+ treats sslmode=require as verify-full, overriding our
  //   ssl: { rejectUnauthorized: false } config
  // - pgbouncer: not a real pg param, just a Prisma hint
  // - supa: Supabase-internal tracking param
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    url = parsed.toString();
  } catch {
    // Not a valid URL (unlikely), fall through with original
  }

  return url;
}

export function buildDatabasePoolOptions(rawUrl: string): PoolConfig {
  return {
    connectionString: sanitiseConnectionString(rawUrl),
    ssl: { rejectUnauthorized: false },
    // Keep pool small for serverless – each lambda gets its own pool
    max: DATABASE_POOL_MAX,
  };
}
