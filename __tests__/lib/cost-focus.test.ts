import { describe, expect, it } from "vitest";
import { normalizeScientificDecimal, parseFocusJsonl } from "@/lib/costs/focus";

const validRow = {
  BilledCost: 12.5,
  BillingCurrency: "USD",
  ChargeCategory: "Usage",
  ChargePeriodStart: "2026-09-01T00:00:00Z",
  ChargePeriodEnd: "2026-09-02T00:00:00Z",
  ConsumedQuantity: 1,
  ConsumedUnit: "GB",
  EffectiveCost: 12.5,
  ServiceName: "Fluid Compute",
  ServiceCategory: "Compute",
  ServiceProviderName: "Vercel",
  Tags: { ProjectId: "prj_test", secret: "should-not-persist" },
  PricingCategory: "Standard",
  PricingCurrency: "USD",
  PricingQuantity: 1,
  PricingUnit: "units",
};

describe("COST-FOCUS-001 FOCUS JSONL parsing", () => {
  it("parses documented fields losslessly and quarantines malformed rows", () => {
    const parsed = parseFocusJsonl(
      `${JSON.stringify(validRow)}\n{"BilledCost":"nope"}\nnot-json`,
    );

    expect(parsed[0]).toMatchObject({
      ok: true,
      row: {
        BilledCost: 12.5,
        BillingCurrency: "USD",
        ServiceName: "Fluid Compute",
        Tags: { ProjectId: "prj_test" },
      },
    });
    if (parsed[0].ok) {
      expect(parsed[0].row.Tags.secret).toBeUndefined();
    }
    expect(parsed[0].ok && parsed[0].row.BilledCostText).toBe("12.5");
    expect(parsed[1]).toMatchObject({
      ok: false,
      reason: "BilledCost must be a decimal number.",
    });
    expect(parsed[2]).toMatchObject({
      ok: false,
      reason: "BilledCost must be a decimal number.",
    });
    expect(normalizeScientificDecimal("1.25e-2")).toBe("0.0125");
    expect(normalizeScientificDecimal("-3e2")).toBe("-300");
  });
});
