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
  Development: "Cursor charges attributed to iTrader.",
  "Vercel Hosting": "Hosting charges for this project.",
  Database: "Database charges for this project.",
  "Shared Hosting": "Shared team hosting allocated to this project.",
  "Provisional Shared Hosting": "Shared team hosting allocated to this project.",
  Other: "Other project charges.",
};

export function interpretManualCostSyncResult(result: {
  error?: unknown;
  data?: { status?: string; message?: string };
}): { ok: boolean; message: string } {
  if (result.data?.status === "succeeded") {
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
    return "Provider costs were refreshed.";
  }
  if (result.status === "locked") {
    return "A cost refresh is already running. Try again in a few minutes.";
  }
  if (result.status === "skipped") {
    return "Cost refresh was skipped because tracking is disabled or the ledger start date is still in the future.";
  }
  return "Provider refresh failed.";
}

