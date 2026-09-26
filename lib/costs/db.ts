import { db } from "@/lib/db";
import type { RuntimeEnv } from "@/lib/runtime-env";
import {
  assertLedgerConfigMatchesEnvironment,
  CostConfigError,
} from "@/lib/costs/config";
import {
  assertNoDirectLedgerDatabase,
  resolveLedgerAccess,
} from "@/lib/costs/ledger-access";

export function costDatabaseIdentity(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/$/, "");
    const username = decodeURIComponent(parsed.username);
    return `${username}@${parsed.hostname.toLowerCase()}:${pathname}`;
  } catch {
    return trimmed;
  }
}

export function assertPreviewCostLedgerReady(
  config: { startedAt: Date; policyVersion: string } | null,
  env: RuntimeEnv = process.env,
): void {
  const access = resolveLedgerAccess(env);
  if (access.mode !== "local") {
    throw new CostConfigError(
      access.mode === "unavailable"
        ? access.reason
        : "This deployment must read the canonical ledger API.",
    );
  }
  if (config) {
    assertLedgerConfigMatchesEnvironment({ ...config, env: env as NodeJS.ProcessEnv });
  }
}

export function resolveCostLedgerConnection(
  env: RuntimeEnv = process.env,
): { mode: "app" } {
  assertNoDirectLedgerDatabase(env);
  const access = resolveLedgerAccess(env);
  if (access.mode !== "local") {
    throw new CostConfigError(
      access.mode === "unavailable"
        ? access.reason
        : "This deployment must read the canonical ledger API.",
    );
  }
  return { mode: "app" };
}

export const costDb = db;
