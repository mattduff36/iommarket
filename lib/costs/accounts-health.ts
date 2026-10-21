import "server-only";
import {
  fetchAccountsCostDashboard,
  type AccountsCostDashboardResult,
} from "@/lib/costs/accounts-reader";
import { accountsReaderRequested } from "@/lib/costs/ledger-access";
import type { RuntimeEnv } from "@/lib/runtime-env";

/** Freshness only. Amounts, sections, and history stay on the Accounts dashboard. */
export type AccountsReaderSyncResult =
  | {
      status: "succeeded";
      source: "accounts";
      asOf: string;
      sourceUpdatedAt: string | null;
    }
  | {
      status: "failed";
      source: "accounts";
    };

export function closedAccountsReaderSync(
  sync: AccountsReaderSyncResult | null,
): AccountsReaderSyncResult {
  return sync ?? { status: "failed", source: "accounts" };
}

export function accountsReaderSyncFromDashboard(
  dashboard: AccountsCostDashboardResult,
): AccountsReaderSyncResult {
  if (!dashboard.available) return { status: "failed", source: "accounts" };
  return {
    status: "succeeded",
    source: "accounts",
    asOf: dashboard.asOf,
    sourceUpdatedAt: dashboard.sourceUpdatedAt,
  };
}

/**
 * Explicit `accounts-reader` only. Returns null for every other role.
 * An unavailable or thrown billing read fails closed and carries no payload.
 */
export async function readAccountsReaderSync(
  env: RuntimeEnv = process.env,
): Promise<AccountsReaderSyncResult | null> {
  if (!accountsReaderRequested(env)) return null;
  try {
    return accountsReaderSyncFromDashboard(await fetchAccountsCostDashboard(env));
  } catch {
    return { status: "failed", source: "accounts" };
  }
}
