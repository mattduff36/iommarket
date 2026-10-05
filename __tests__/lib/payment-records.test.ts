import { describe, expect, it } from "vitest";
import {
  isPaidSubscriptionRecord,
  isRecognisedListingRevenue,
  isRecognisedSubscriptionCharge,
  recognisedListingPaymentWhere,
  recognisedSubscriptionChargeWhere,
} from "@/lib/payments/records";

describe("subscription revenue classification", () => {
  it("excludes free admin grants from paid subscription reporting", () => {
    expect(isPaidSubscriptionRecord({ source: "ADMIN_GRANT" })).toBe(false);
    expect(isPaidSubscriptionRecord({ source: "PAYMENT" })).toBe(true);
  });

  it("excludes a refunded subscription charge from recognised revenue", () => {
    expect(recognisedSubscriptionChargeWhere()).toEqual({ refundedAt: null });
    expect(isRecognisedSubscriptionCharge({ refundedAt: null })).toBe(true);
    expect(isRecognisedSubscriptionCharge({ refundedAt: new Date("2026-10-05T12:00:00.000Z") })).toBe(false);
  });

  it("recognises listing revenue only after a payment has succeeded", () => {
    expect(recognisedListingPaymentWhere()).toEqual({
      status: "SUCCEEDED",
      refundedAt: null,
    });
    expect(isRecognisedListingRevenue({ status: "SUCCEEDED", refundedAt: null })).toBe(true);
    expect(isRecognisedListingRevenue({ status: "PENDING", refundedAt: null })).toBe(false);
    expect(isRecognisedListingRevenue({
      status: "SUCCEEDED",
      refundedAt: new Date("2026-10-05T12:00:00.000Z"),
    })).toBe(false);
  });
});
