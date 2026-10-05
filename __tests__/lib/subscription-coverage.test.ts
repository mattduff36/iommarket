import { describe, expect, it } from "vitest";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { remainingSubscriptionCoverage } from "@/lib/payments/subscription-coverage";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const PRO = RIPPLE_CANONICAL_PRODUCTS.pro;

function charge(input: {
  id: string;
  at: string;
  refundedAt?: string;
  amount?: number;
}) {
  return {
    id: input.id,
    eventTimestamp: new Date(input.at),
    amount: input.amount ?? PRO.amountPence,
    currency: "gbp",
    refundedAt: input.refundedAt ? new Date(input.refundedAt) : null,
  };
}

describe("subscription coverage after refund", () => {
  it("drops access funded only by the refunded charge", () => {
    const coverage = remainingSubscriptionCoverage({
      product: PRO,
      charges: [charge({ id: "older", at: "2026-09-15T10:00:00.000Z", refundedAt: "2026-09-20T10:00:00.000Z" })],
      storedPeriodEnd: new Date("2026-10-15T10:00:00.000Z"),
      now: NOW,
    });

    expect(coverage).toMatchObject({ status: "CANCELLED", currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(isPaidSubscriptionEntitled({ status: coverage.status, currentPeriodEnd: coverage.currentPeriodEnd }, NOW)).toBe(false);
  });

  it("keeps a later unrefunded charge and does not keep the refunded charge's later date", () => {
    const coverage = remainingSubscriptionCoverage({
      product: PRO,
      charges: [
        charge({ id: "older", at: "2026-09-01T00:00:00.000Z", refundedAt: "2026-10-04T00:00:00.000Z" }),
        charge({ id: "later", at: "2026-10-01T00:00:00.000Z" }),
      ],
      storedPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      now: NOW,
    });

    expect(coverage.ambiguities).toEqual([]);
    expect(coverage.status).toBe("ACTIVE");
    expect(coverage.currentPeriodEnd).toEqual(new Date("2026-11-01T00:00:00.000Z"));
    expect(isPaidSubscriptionEntitled({ status: coverage.status, currentPeriodEnd: coverage.currentPeriodEnd }, NOW)).toBe(true);
  });

  it("reports a stored period that charge evidence cannot explain", () => {
    const coverage = remainingSubscriptionCoverage({
      product: PRO,
      charges: [charge({ id: "only", at: "2026-09-01T00:00:00.000Z", refundedAt: "2026-09-02T00:00:00.000Z" })],
      storedPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      now: NOW,
    });

    expect(coverage.status).toBe("CANCELLED");
    expect(coverage.ambiguities.map((item) => item.code)).toContain("stored-period-exceeds-charge-evidence");
  });

  it("does not invent a period when the product or charge amount does not match", () => {
    const unknown = remainingSubscriptionCoverage({
      product: null,
      charges: [charge({ id: "only", at: "2026-09-15T00:00:00.000Z" })],
      storedPeriodEnd: new Date("2026-10-15T00:00:00.000Z"),
      now: NOW,
    });
    const unmatched = remainingSubscriptionCoverage({
      product: PRO,
      charges: [charge({ id: "other-amount", at: "2026-09-15T00:00:00.000Z", amount: 100 })],
      storedPeriodEnd: new Date("2026-10-15T00:00:00.000Z"),
      now: NOW,
    });

    expect(unknown.ambiguities).toEqual([{ code: "unknown-product" }]);
    expect(unknown.status).toBe("CANCELLED");
    expect(unmatched.ambiguities.map((item) => item.code)).toEqual([
      "unmatched-charge",
      "stored-period-exceeds-charge-evidence",
    ]);
    expect(unmatched.currentPeriodEnd).toBeNull();
  });

  it("keeps a scheduled cancellation when unrefunded coverage remains", () => {
    const coverage = remainingSubscriptionCoverage({
      product: PRO,
      charges: [
        charge({ id: "older", at: "2026-09-01T00:00:00.000Z", refundedAt: "2026-10-04T00:00:00.000Z" }),
        charge({ id: "later", at: "2026-10-01T00:00:00.000Z" }),
      ],
      storedPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      now: NOW,
      scheduledCancellation: true,
    });

    expect(coverage).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
  });
});
