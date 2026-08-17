import type { CostSyncResult } from "@/lib/costs/sync";

export const COST_REFRESH_HELP =
  "Use Refresh provider costs to try again.";

export const COST_INVOICE_HELP =
  "Use the button below to request an invoice for this amount.";

export const COST_EMPTY_HELP =
  "No costs to show yet. Use Refresh provider costs or Add manual cost to get started.";

export const COST_NON_OWNER_HELP =
  "Ask the configured owner to refresh costs, add manual entries, or request invoices.";

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
  return "Provider cost refresh failed. Check the sync card for the latest status.";
}

export function syncHealthLabel(input: {
  status: string;
  stale: boolean;
}): string {
  if (input.stale && input.status === "FAILED") return "Last refresh failed";
  if (input.stale && input.status === "NONE") return "No refresh yet";
  if (input.stale) return "Refresh is overdue";
  if (input.status === "SUCCEEDED") return "Up to date";
  if (input.status === "RUNNING") return "Refresh in progress";
  return input.status;
}

export function syncHealthDetail(input: {
  status: string;
  stale: boolean;
  completedAt: string | null;
  quarantinedCount: number;
}): string {
  const completed = input.completedAt
    ? `Last completed ${new Date(input.completedAt).toLocaleString("en-GB", {
        timeZone: "Europe/London",
      })}.`
    : "No successful refresh has been recorded.";
  const quarantine =
    input.quarantinedCount > 0
      ? ` ${input.quarantinedCount} provider rows could not be classified.`
      : "";
  if (input.status === "FAILED") {
    return `The latest refresh failed. ${completed}${quarantine}`;
  }
  if (input.stale && input.status === "NONE") {
    return `No provider costs yet. ${COST_REFRESH_HELP}`;
  }
  if (input.stale) {
    return `The ledger is waiting for a newer refresh. ${completed}${quarantine}`;
  }
  return `${completed}${quarantine}`;
}
