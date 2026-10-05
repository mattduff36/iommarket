import { describe, expect, it } from "vitest";
import {
  isPaidSubscriptionRecord,
  isRecognisedSubscriptionCharge,
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
});
