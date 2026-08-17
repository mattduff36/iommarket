import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { buildDatabasePoolOptions } from "./pool-options";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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

  const pool = new pg.Pool(buildDatabasePoolOptions(raw));
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
