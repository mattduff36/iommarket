import { describe, expect, it } from "vitest";
import { costSyncRequestSchema, recordManualCostSchema } from "@/lib/validations/costs";

describe("cost input validation", () => {
  it("rejects zero amounts and inverted periods", () => {
    expect(
      recordManualCostSchema.safeParse({
        category: "CURSOR",
        externalRef: "cursor-1",
        nativeAmount: "0.00",
        nativeCurrency: "USD",
        displayLabel: "Cursor",
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
