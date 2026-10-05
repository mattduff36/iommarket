import { describe, expect, it } from "vitest";
import { reconcileRipplePaymentSchema } from "@/lib/validations/admin";

describe("Ripple admin recovery validation", () => {
  const valid = {
    paymentId: "cmuv64171000004l4zs1prajl",
    providerPaymentId: "260921004609311316",
    providerEventAt: new Date("2026-10-05T11:29:57Z"),
    confirmedAmountCurrencyProduct: true,
    confirmedCurrentlyPaidAndNotRefunded: true,
    notes: "Verified against the Ripple portal.",
  };

  it("accepts complete provider attestation", () => {
    expect(reconcileRipplePaymentSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    { providerPaymentId: "not-a-reference" },
    { confirmedAmountCurrencyProduct: false },
    { confirmedCurrentlyPaidAndNotRefunded: false },
    { notes: "" },
  ])("rejects incomplete or untrusted recovery input", (override) => {
    expect(
      reconcileRipplePaymentSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});
