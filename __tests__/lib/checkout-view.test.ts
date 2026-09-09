import { describe, expect, it } from "vitest";
import {
  checkoutViewCopy,
  resolveCheckoutViewState,
} from "@/lib/payments/checkout-view";

describe("checkout view state", () => {
  it("uses submitted copy when the listing is PENDING", () => {
    const state = resolveCheckoutViewState({
      listingStatus: "PENDING",
      payment: { status: "PENDING" },
      openedInNewTab: true,
    });
    expect(state).toBe("submitted");
    expect(checkoutViewCopy(state).heading).toBe("Listing submitted");
  });

  it("uses paid copy when Payment is SUCCEEDED", () => {
    const state = resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "SUCCEEDED" },
      openedInNewTab: true,
    });
    expect(state).toBe("paid");
    expect(checkoutViewCopy(state).heading).toBe("Payment received");
  });

  it("uses failed copy when Payment is FAILED", () => {
    const state = resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "FAILED" },
      openedInNewTab: true,
    });
    expect(state).toBe("failed");
    expect(checkoutViewCopy(state).heading).toBe("Payment failed");
  });

  it("uses waiting copy when a PENDING payment exists", () => {
    const state = resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "PENDING" },
      openedInNewTab: true,
    });
    expect(state).toBe("waiting");
    expect(checkoutViewCopy(state).isAwaitingPayment).toBe(true);
    expect(checkoutViewCopy(state).heading).toBe(
      "Waiting for payment confirmation",
    );
  });
});
