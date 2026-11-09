import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { buildDatabasePoolOptions } from "./pool-options";

// Reuse the client if this module is loaded again in the same runtime.
const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

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

  const onVercel = process.env.VERCEL === "1";
  const pool = new pg.Pool({
    ...buildDatabasePoolOptions(raw),
    ...(onVercel ? { application_name: "iommarket-web", idleTimeoutMillis: 5_000 } : {}),
  });
  if (onVercel) attachDatabasePool(pool);
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

/**
 * Lazily reuse one Prisma client and pool per runtime instance.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop);
  },
});
