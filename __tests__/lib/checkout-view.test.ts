import { describe, expect, it } from "vitest";
import {
  checkoutViewCopy,
  resolveCheckoutViewState,
} from "@/lib/payments/checkout-view";

describe("checkout view state", () => {
  it("offers manual review after two minutes without claiming payment succeeded", () => {
    const createdAt = new Date("2026-09-28T21:00:00Z");
    const state = resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "PENDING", createdAt },
      openedInNewTab: true,
      now: new Date("2026-09-28T21:02:00Z"),
    });
    expect(state).toBe("review");
    expect(checkoutViewCopy(state).message).toMatch(/do not pay again/i);
    expect(checkoutViewCopy(state).isAwaitingPayment).toBe(true);
  });

  it("keeps a fresh attempt waiting and never uses age as proof of payment", () => {
    expect(resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "PENDING", createdAt: new Date("2026-09-28T21:00:00Z") },
      openedInNewTab: true,
      now: new Date("2026-09-28T21:01:59Z"),
    })).toBe("waiting");
  });

  it("stops waiting after staff confirmation even for an old attempt", () => {
    expect(resolveCheckoutViewState({
      listingStatus: "DRAFT",
      payment: { status: "SUCCEEDED", createdAt: new Date("2026-09-28T21:00:00Z") },
      openedInNewTab: true,
      now: new Date("2026-09-28T22:00:00Z"),
    })).toBe("paid");
  });
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
