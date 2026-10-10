import type { CostSyncResult } from "@/lib/costs/sync";

export const COST_REFRESH_HELP =
  "Use Refresh provider costs to try again.";

export const COST_INVOICE_HELP =
  "Use the button below to request an invoice for this amount.";

export const COST_EMPTY_HELP =
  "No costs to show yet. Use Refresh provider costs or Add manual cost to get started.";

export const COST_NON_OWNER_HELP =
  "Ask the configured owner to refresh costs, add manual entries, or request invoices.";

export const COST_SECTION_HELP: Record<string, string> = {
  "Development (Cursor)":
    "Daily Cursor usage used to build and maintain iTrader. Matching entries are combined and net amounts below £0.01 are hidden.",
  "Website hosting (Vercel)":
    "Vercel services used by iTrader. Matching service charges are combined and net amounts below £0.01 are hidden.",
  Database:
    "Database services used by iTrader. Matching charges are combined and net amounts below £0.01 are hidden.",
  Other:
    "Other costs recorded for iTrader. Matching charges are combined and net amounts below £0.01 are hidden.",
};

export function interpretManualCostSyncResult(result: {
  error?: unknown;
  data?: { status?: string; message?: string };
}): { ok: boolean; message: string } {
  if (result.data?.status === "succeeded" || result.data?.status === "partial") {
    return {
      ok: true,
      message: result.data.message || manualCostSyncMessage({ status: "succeeded" }),
    };
  }
  if (typeof result.error === "string" && result.error) {
    return { ok: false, message: result.error };
  }
  if (result.data?.message) {
    return { ok: false, message: result.data.message };
  }
  return { ok: false, message: manualCostSyncMessage({ status: "failed" }) };
}

export function manualCostSyncMessage(result: CostSyncResult): string {
  if (result.status === "succeeded") {
    return result.caughtUp === false
      ? "Provider costs were refreshed. More history remains for the next refresh."
      : "Provider costs were refreshed.";
  }
  if (result.status === "partial") {
    return "Provider costs were partly refreshed. More history remains for the next refresh.";
  }
  if (result.status === "locked") {
    return "A cost refresh is already running. Try again in a few minutes.";
  }
  if (result.status === "skipped") {
    return "Cost refresh was skipped because tracking is disabled or the ledger start date is still in the future.";
  }
  if (result.errorCode === "VERCEL_BILLING_UNAVAILABLE") {
    return "Vercel billing is temporarily unavailable.";
  }
  if (result.errorCode === "COST_SYNC_TIMEOUT") {
    return "Provider refresh timed out before it could finish.";
  }
  if (result.errorCode === "CostConfigError") {
    return "Provider refresh configuration is incomplete.";
  }
  return "Provider refresh failed.";
}

