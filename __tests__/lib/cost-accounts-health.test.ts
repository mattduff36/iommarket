/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAccountsCostDashboard = vi.fn();

vi.mock("@/lib/costs/accounts-reader", () => ({
  fetchAccountsCostDashboard,
}));

const readableDashboard = {
  available: true as const,
  chartAvailable: true,
  sections: [{ key: "CURSOR", label: "Cursor", amountLabel: "£43.21", provisional: true, lines: [] }],
  costTotalPence: 4321,
  invoicedPence: 1000,
  remainingToInvoicePence: 3321,
  sourceUpdatedAt: "2026-10-20T08:00:00.000Z",
  asOf: "2026-10-21T09:00:00.000Z",
  history: [{
    day: "2026-10-20",
    costPence: 4321,
    invoicedPence: 1000,
    remainingToInvoicePence: 3321,
  }],
};

describe("accounts reader health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores every role other than the exact accounts reader", async () => {
    const { readAccountsReaderSync } = await import("@/lib/costs/accounts-health");
    await expect(readAccountsReaderSync({ COST_LEDGER_ROLE: "canonical" })).resolves.toBeNull();
    await expect(readAccountsReaderSync({ COST_LEDGER_ROLE: "accounts-preview" })).resolves.toBeNull();
    await expect(readAccountsReaderSync({ COST_LEDGER_ROLE: "accounts-reader " })).resolves.toBeNull();
    expect(fetchAccountsCostDashboard).not.toHaveBeenCalled();
  });

  it("keeps only Accounts freshness when billing is available", async () => {
    fetchAccountsCostDashboard.mockResolvedValue(readableDashboard);
    const { accountsReaderSyncFromDashboard, readAccountsReaderSync } = await import(
      "@/lib/costs/accounts-health"
    );
    const env = { COST_LEDGER_ROLE: "accounts-reader" };
    const sync = await readAccountsReaderSync(env);
    expect(fetchAccountsCostDashboard).toHaveBeenCalledTimes(1);
    expect(fetchAccountsCostDashboard).toHaveBeenCalledWith(env);
    expect(sync).toEqual({
      status: "succeeded",
      source: "accounts",
      asOf: "2026-10-21T09:00:00.000Z",
      sourceUpdatedAt: "2026-10-20T08:00:00.000Z",
    });
    expect(accountsReaderSyncFromDashboard(readableDashboard)).toEqual(sync);
    expect(JSON.stringify(sync)).not.toContain("4321");
  });

  it("fails closed when billing is unavailable or the read throws", async () => {
    const { closedAccountsReaderSync, readAccountsReaderSync } = await import(
      "@/lib/costs/accounts-health"
    );
    const env = { COST_LEDGER_ROLE: "accounts-reader" };
    fetchAccountsCostDashboard.mockResolvedValue({ available: false });
    await expect(readAccountsReaderSync(env)).resolves.toEqual({
      status: "failed",
      source: "accounts",
    });
    fetchAccountsCostDashboard.mockRejectedValue(new Error("reader token unavailable"));
    await expect(readAccountsReaderSync(env)).resolves.toEqual({
      status: "failed",
      source: "accounts",
    });
    expect(closedAccountsReaderSync(null)).toEqual({ status: "failed", source: "accounts" });
  });
});
