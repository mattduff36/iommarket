import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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

  // Sanitise: trim whitespace / stray newlines that break pg connection strings
  const connectionString = raw.trim();

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
