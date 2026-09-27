/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { assertCanonicalLedgerWriter, createManualCostCategory } = vi.hoisted(() => ({
  assertCanonicalLedgerWriter: vi.fn(),
  createManualCostCategory: vi.fn(),
}));

vi.mock("@/lib/costs/ledger-role", () => ({
  assertCanonicalLedgerWriter,
}));

vi.mock("@/lib/costs/manual-categories", () => ({
  createManualCostCategory,
  ManualCategoryError: class ManualCategoryError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ManualCategoryError";
    }
  },
}));

const originalEnv = {
  enabled: process.env.COSTS_ENABLED,
  request: process.env.COST_LEDGER_REQUEST_SECRET,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("canonical manual category API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_REQUEST_SECRET = "request-secret";
    createManualCostCategory.mockResolvedValue({
      category: { slug: "office-supplies", label: "Office Supplies" },
      categories: [{ slug: "office-supplies", label: "Office Supplies" }],
    });
  });

  afterEach(() => {
    restore("COSTS_ENABLED", originalEnv.enabled);
    restore("COST_LEDGER_REQUEST_SECRET", originalEnv.request);
  });

  it("persists a category for an authorized canonical writer", async () => {
    const { POST } = await import("@/app/api/internal/cost-ledger/manual-categories/route");
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual-categories", {
        method: "POST",
        headers: {
          authorization: "Bearer request-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "Office Supplies" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createManualCostCategory).toHaveBeenCalledWith("Office Supplies");
  });

  it("rejects a duplicate category and a missing secret", async () => {
    const { ManualCategoryError } = await import("@/lib/costs/manual-categories");
    createManualCostCategory.mockRejectedValue(new ManualCategoryError("That category already exists."));
    const { POST } = await import("@/app/api/internal/cost-ledger/manual-categories/route");
    const duplicate = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual-categories", {
        method: "POST",
        headers: {
          authorization: "Bearer request-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "Manual Adjustment" }),
      }),
    );
    expect(duplicate.status).toBe(409);

    const denied = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Office Supplies" }),
      }),
    );
    expect(denied.status).toBe(401);
  });
});
