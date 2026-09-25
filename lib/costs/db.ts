import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { CostConfigError } from "@/lib/costs/config";
import { db } from "@/lib/db";
import { buildDatabasePoolOptions } from "@/lib/db/pool-options";
import type { RuntimeEnv } from "@/lib/runtime-env";

const MARKETPLACE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

const globalForCostLedger = globalThis as unknown as {
  costLedgerPrisma: PrismaClient | undefined;
};

export type CostLedgerConnection =
  | { mode: "app" }
  | { mode: "ledger"; url: string };

function databaseIdentity(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.toLowerCase()}:${pathname}`;
  } catch {
    return trimmed;
  }
}

function marketplaceIdentities(env: RuntimeEnv): string[] {
  return MARKETPLACE_URL_KEYS.flatMap((key) => {
    const value = env[key]?.trim();
    return value ? [databaseIdentity(value)] : [];
  });
}

export function resolveCostLedgerConnection(
  env: RuntimeEnv = process.env,
): CostLedgerConnection {
  if (env.VERCEL_ENV !== "preview") {
    return { mode: "app" };
  }

  const ledgerUrl = env.COST_LEDGER_DATABASE_URL?.trim();
  if (!ledgerUrl) {
    throw new CostConfigError(
      "COST_LEDGER_DATABASE_URL is required on preview.",
    );
  }

  const ledgerIdentity = databaseIdentity(ledgerUrl);
  if (marketplaceIdentities(env).includes(ledgerIdentity)) {
    throw new CostConfigError(
      "COST_LEDGER_DATABASE_URL must not be the preview marketplace database.",
    );
  }

  return { mode: "ledger", url: ledgerUrl };
}

function createLedgerClient(url: string): PrismaClient {
  const pool = new pg.Pool(buildDatabasePoolOptions(url));
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function ledgerClient(): PrismaClient {
  const connection = resolveCostLedgerConnection();
  if (connection.mode === "app") {
    return db;
  }
  if (!globalForCostLedger.costLedgerPrisma) {
    globalForCostLedger.costLedgerPrisma = createLedgerClient(connection.url);
  }
  return globalForCostLedger.costLedgerPrisma;
}

export const costDb = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(ledgerClient(), prop);
  },
});
