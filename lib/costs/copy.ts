import type { CostSyncResult } from "@/lib/costs/sync";

export const COST_PAGE_INTRO =
  "This page shows the saved project cost ledger. Opening it does not refresh provider charges.";

export const COST_REFRESH_HELP =
  "Vercel hosting and shared team charges refresh daily at 04:00 UTC, after a verified production deployment, or when the owner refreshes provider costs.";

export const COST_CALCULATION_HELP =
  "Each imported amount is converted with the service-period business-day USD/GBP rate. Weekends use Friday’s rate.";

export const COST_ALLOCATION_HELP =
  "Shared Vercel charges are split equally across active production projects. Current-month shared rows stay provisional until that month closes. Development, Other, and external Supabase database costs are recorded manually.";

export const COST_INVOICE_HELP =
  "Outstanding invoiceable is the unsettled invoiceable total. It shows £0.00 while an invoice request is pending. Confirmed invoices drop those rows from the live total.";

export const COST_DISABLED_HELP =
  "Project cost tracking is turned off. Provider charges will not import until it is enabled.";

export const COST_EMPTY_HELP =
  "No ledger rows have been saved yet. Automatic Vercel charges appear after a successful refresh. Development and Other costs have to be recorded by the owner.";

export const COST_NON_OWNER_HELP =
  "Only the configured owner can record manual costs, refresh provider charges, or confirm invoices.";

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
    return `Provider charges have not been imported yet. ${COST_REFRESH_HELP}`;
  }
  if (input.stale) {
    return `The ledger is waiting for a newer refresh. ${completed}${quarantine}`;
  }
  return `${completed}${quarantine}`;
}
