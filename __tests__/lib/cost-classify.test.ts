import { describe, expect, it } from "vitest";
import {
  aggregateClassifiedCharges,
  classifyFocusRow,
  classifyFocusRows,
} from "@/lib/costs/classify";
import type { FocusChargeRow } from "@/lib/costs/focus";

const config = {
  projectId: "prj_iom",
  databaseResourceId: "store_db",
  now: new Date("2026-09-15T00:00:00.000Z"),
};

function row(overrides: Partial<FocusChargeRow> = {}): FocusChargeRow {
  return {
    BilledCost: 10,
    BillingCurrency: "USD",
    ChargeCategory: "Usage",
    ChargePeriodStart: "2026-09-01T00:00:00.000Z",
    ChargePeriodEnd: "2026-09-02T00:00:00.000Z",
    ConsumedQuantity: 1,
    ConsumedUnit: "units",
    EffectiveCost: 10,
    RegionId: null,
    RegionName: null,
    ServiceName: "Fluid Compute",
    ServiceCategory: "Compute",
    ServiceProviderName: "Vercel",
    Tags: { ProjectId: "prj_iom" },
    PricingCategory: "Standard",
    PricingCurrency: "USD",
    PricingQuantity: 1,
    PricingUnit: "units",
    ...overrides,
  };
}

describe("COST-CLASS-001 FOCUS classification", () => {
  it("classifies hosting, marketplace database, shared, credit and tax rows exclusively", () => {
    const hosting = classifyFocusRow(row(), config);
    const database = classifyFocusRow(
      row({
        ServiceName: "Supabase",
        ServiceCategory: "Databases",
        Tags: { ResourceId: "store_db", ProjectId: "prj_iom" },
      }),
      config,
    );
    const shared = classifyFocusRow(row({ Tags: {} }), config);
    const otherProject = classifyFocusRow(row({ Tags: { ProjectId: "prj_other" } }), config);
    const credit = classifyFocusRow(row({ ChargeCategory: "Credit", BilledCost: -2 }), config);
    const tax = classifyFocusRow(row({ ChargeCategory: "Tax", BilledCost: 1.2 }), config);
    const gbp = classifyFocusRow(row({ BillingCurrency: "GBP" }), config);

    expect(hosting).toMatchObject({ kind: "hosting", category: "VERCEL_HOSTING" });
    expect(database).toMatchObject({ kind: "database", category: "DATABASE" });
    expect(shared).toMatchObject({ kind: "shared", category: "SHARED_VERCEL" });
    expect(otherProject).toMatchObject({ kind: "ignored" });
    expect(credit).toMatchObject({ kind: "hosting" });
    expect(tax).toMatchObject({ kind: "hosting" });
    expect(gbp).toMatchObject({ reason: "Unsupported billing currency." });

    const classified = classifyFocusRows(
      [
        { row: row(), rawIndex: 0 },
        { row: row({ Tags: { ResourceId: "store_db" } }), rawIndex: 1 },
        { row: row({ Tags: {} }), rawIndex: 2 },
      ],
      config,
    );
    expect(classified.classified.map((item) => item.kind).sort()).toEqual([
      "database",
      "hosting",
      "shared",
    ]);

    const first = classifyFocusRow(row({ BilledCost: 10 }), config);
    const second = classifyFocusRow(row({ BilledCost: 2.5 }), config);
    if ("reason" in first || "reason" in second) {
      throw new Error("expected classified rows");
    }
    const aggregated = aggregateClassifiedCharges([
      { ...first, nativeAmount: "10" },
      { ...second, nativeAmount: "2.5" },
    ]);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].nativeAmount).toBe("12.5");
  });
});
