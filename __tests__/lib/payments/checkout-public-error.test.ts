import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({
  captureException: vi.fn(async () => {
    throw new Error("monitor down");
  }),
}));

import {
  CHECKOUT_OUTCOME_UNKNOWN,
  checkoutUnknownResult,
  trustedCheckoutMessage,
} from "@/lib/payments/checkout-public-error";

describe("trusted checkout errors", () => {
  it("keeps a known configuration code and hides a raw provider sentence", () => {
    expect(trustedCheckoutMessage("RIPPLE_LISTING_PAYMENT_URL is not set")).toBe(
      "Listing checkout is not configured yet. Please contact support.",
    );
    expect(trustedCheckoutMessage("Ripple listing amount must be 749 pence")).toBe(
      "Checkout pricing does not match the Ripple payment link. Please contact support.",
    );
    expect(trustedCheckoutMessage(
      "postgres failed near RIPPLE_LISTING_PAYMENT_URL https://pay.example/tok_secret",
    )).toBeNull();
  });

  it("keeps the uncertain checkout body when monitoring capture throws", async () => {
    const body = await checkoutUnknownResult(new Error("https://pay.example/tok_secret"), {
      action: "payForListing",
      route: "/sell/checkout",
    });
    expect(body).toMatchObject({
      error: CHECKOUT_OUTCOME_UNKNOWN,
      code: "unknown",
      retryable: false,
    });
    expect(body.error).not.toMatch(/tok_secret|https:|not charged|was not charged/i);
    expect(body.supportReference).toBeUndefined();
  });
});
