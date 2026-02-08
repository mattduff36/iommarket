import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function sanitiseConnectionString(raw: string): string {
  // Trim whitespace / stray newlines that break pg connection strings
  let url = raw.trim();

  // Strip sslmode param – newer pg (v8.x+) treats sslmode=require as
  // verify-full which overrides our explicit ssl config and fails against
  // Supabase's certificate chain.  We handle SSL via the Pool options instead.
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    url = parsed.toString();
  } catch {
    // Not a valid URL (unlikely), fall through with original
  }

  return url;
}

function createPrismaClient(): PrismaClient {
  // Prefer the Supabase-integration non-pooling URL, fall back to DATABASE_URL
  const raw =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL;

  if (!raw) {
    throw new Error(
      "Neither POSTGRES_URL_NON_POOLING nor DATABASE_URL is set"
    );
  }

  const connectionString = sanitiseConnectionString(raw);

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
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
