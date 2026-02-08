import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function sanitiseConnectionString(raw: string): string {
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

function createPrismaClient(): PrismaClient {
  // Prefer transaction-mode pooler URL (port 6543) for serverless,
  // fall back to session-mode / direct, then DATABASE_URL.
  const raw =
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL;

  if (!raw) {
    throw new Error(
      "No database URL found (checked POSTGRES_URL, POSTGRES_URL_NON_POOLING, DATABASE_URL)"
    );
  }

  const connectionString = sanitiseConnectionString(raw);

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Keep pool small for serverless – each lambda gets its own pool
    max: 5,
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

/**
 * Lazy-initialised Prisma client. Uses a global singleton in development
 * to avoid exhausting connections during hot-reload.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop);
  },
});
