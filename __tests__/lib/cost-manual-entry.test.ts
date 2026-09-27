import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyClassifiedCharge, listManualCostCategories } = vi.hoisted(() => ({
  applyClassifiedCharge: vi.fn(),
  listManualCostCategories: vi.fn(),
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {},
}));

vi.mock("@/lib/costs/manual-categories", () => ({
  listManualCostCategories,
}));

vi.mock("@/lib/costs/transaction", () => ({
  runSerializable: async (fn: (tx: object) => Promise<void>) => fn({}),
}));

vi.mock("@/lib/costs/ledger", () => ({
  applyClassifiedCharge,
  ensureLedgerConfig: async () => ({ startedAt: new Date("2026-08-13T23:00:00.000Z") }),
  CostLedgerError: class CostLedgerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CostLedgerError";
    }
  },
}));

vi.mock("@/lib/costs/fx", () => ({
  getOrCreateIdentityGbpRate: async () => ({ id: "fx-gbp", rate: "1" }),
  getOrCreateUsdGbpRate: async () => ({ id: "fx-usd", rate: "0.8" }),
}));

import { recordManualLedgerCost } from "@/lib/costs/manual-entry";

const input = {
  categorySlug: "manual-adjustment",
  nativeAmount: "-12.50",
  nativeCurrency: "GBP" as const,
  displayLabel: "Exclude costs page work",
  periodStart: "2026-08-17T00:00:00.000Z",
  periodEnd: "2026-09-27T00:00:00.000Z",
};

describe("manual ledger entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listManualCostCategories.mockResolvedValue([
      { slug: "manual-adjustment", label: "Manual Adjustment" },
    ]);
  });

  it("stores an other-category charge with a generated reference", async () => {
    await recordManualLedgerCost(input);
    await recordManualLedgerCost(input);

    expect(applyClassifiedCharge).toHaveBeenCalledTimes(2);
    const first = applyClassifiedCharge.mock.calls[0]?.[1];
    const second = applyClassifiedCharge.mock.calls[1]?.[1];
    expect(first).toMatchObject({
      category: "OTHER",
      nativeAmount: "-12.50",
      displayLabel: "Exclude costs page work",
      metadata: {
        manualCategorySlug: "manual-adjustment",
        manualCategoryLabel: "Manual Adjustment",
      },
    });
    expect(first.bucketKey).toMatch(/^manual:manual-adjustment:gen-/);
    expect(second.bucketKey).toMatch(/^manual:manual-adjustment:gen-/);
    expect(first.bucketKey).not.toBe(second.bucketKey);
  });

  it("rejects an unknown category", async () => {
    await expect(
      recordManualLedgerCost({ ...input, categorySlug: "missing-category" }),
    ).rejects.toThrow(/choose a cost category/i);
    expect(applyClassifiedCharge).not.toHaveBeenCalled();
  });
});
