import { describe, expect, it } from "vitest";
import { classifySubscriptionRefund } from "@/lib/payments/subscription-refund";

describe("Ripple subscription refund amounts", () => {
  it("accepts only an exact full charge", () => {
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: 4999,
      refundCurrency: "gbp",
    })).toEqual({ kind: "full" });
  });

  it("keeps a smaller amount as a partial refund", () => {
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: 1000,
      refundCurrency: "GBP",
    })).toEqual({ kind: "partial", refundedPence: 1000, chargePence: 4999 });
  });

  it("rejects a missing, zero, larger, or different-currency amount", () => {
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: null,
      refundCurrency: "gbp",
    }).kind).toBe("mismatch");
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: 0,
      refundCurrency: "gbp",
    })).toMatchObject({ kind: "mismatch", reason: "zero" });
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: 5000,
      refundCurrency: "gbp",
    })).toMatchObject({ kind: "mismatch", reason: "exceeds-charge" });
    expect(classifySubscriptionRefund({
      chargeAmount: 4999,
      chargeCurrency: "gbp",
      refundAmount: 4999,
      refundCurrency: "eur",
    })).toMatchObject({ kind: "mismatch", reason: "currency" });
  });
});
