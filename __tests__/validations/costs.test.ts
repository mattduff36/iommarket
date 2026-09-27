import { describe, expect, it } from "vitest";
import { costSyncRequestSchema, recordManualCostSchema } from "@/lib/validations/costs";

describe("cost input validation", () => {
  it("rejects zero amounts and inverted periods", () => {
    expect(
      recordManualCostSchema.safeParse({
        category: "DATABASE",
        externalRef: "database-1",
        nativeAmount: "0.00",
        nativeCurrency: "USD",
        displayLabel: "Database",
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-09-02T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      recordManualCostSchema.safeParse({
        category: "OTHER",
        externalRef: "domain-1",
        nativeAmount: "12.50",
        nativeCurrency: "GBP",
        displayLabel: "Domain",
        periodStart: "2026-09-02T00:00:00.000Z",
        periodEnd: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts a negative reduction and rejects Cursor manual imports", () => {
    expect(
      recordManualCostSchema.safeParse({
        category: "OTHER",
        externalRef: "exclude-costs-page",
        nativeAmount: "-12.50",
        nativeCurrency: "GBP",
        displayLabel: "Exclude costs page work",
        periodStart: "2026-08-17T00:00:00.000Z",
        periodEnd: "2026-09-27T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      recordManualCostSchema.safeParse({
        category: "CURSOR",
        externalRef: "cursor-1",
        nativeAmount: "100.00",
        nativeCurrency: "USD",
        displayLabel: "Cursor",
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-09-02T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires a deployment URL and ignores an event id alone", () => {
    expect(costSyncRequestSchema.safeParse({}).success).toBe(false);
    expect(costSyncRequestSchema.safeParse({ eventId: "dpl_1" }).success).toBe(false);
    expect(
      costSyncRequestSchema.safeParse({
        deploymentUrl: "https://iommarket.vercel.app",
      }).success,
    ).toBe(true);
  });
});
