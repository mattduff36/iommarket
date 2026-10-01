import { describe, expect, it } from "vitest";
import {
  DEALER_PROFILE_ADDRESS_CHANGE_LIMIT,
  DEALER_PROFILE_ADDRESS_CHANGE_LIMIT_MESSAGE,
  getDealerProfileAddressChangeError,
  getDealerProfileAddressChangeWindowStart,
  shouldCountDealerProfileAddressChange,
} from "@/lib/dealers/profile-address";

describe("dealer profile address change policy", () => {
  it("does not consume a change for a no-op", () => {
    expect(
      getDealerProfileAddressChangeError({
        currentSlug: "dealer-one",
        nextSlug: "dealer-one",
        changesInWindow: DEALER_PROFILE_ADDRESS_CHANGE_LIMIT,
      }),
    ).toBeNull();
  });

  it("allows changes below the rolling limit and blocks at the limit", () => {
    expect(
      getDealerProfileAddressChangeError({
        currentSlug: "dealer-one",
        nextSlug: "dealer-two",
        changesInWindow: DEALER_PROFILE_ADDRESS_CHANGE_LIMIT - 1,
      }),
    ).toBeNull();
    expect(
      getDealerProfileAddressChangeError({
        currentSlug: "dealer-one",
        nextSlug: "dealer-two",
        changesInWindow: DEALER_PROFILE_ADDRESS_CHANGE_LIMIT,
      }),
    ).toBe(DEALER_PROFILE_ADDRESS_CHANGE_LIMIT_MESSAGE);
  });

  it("starts the rolling window exactly 365 days before now", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(getDealerProfileAddressChangeWindowStart(now).toISOString()).toBe(
      "2025-10-01T12:00:00.000Z",
    );
  });

  it("does not count generated placeholder assignment or system changes", () => {
    expect(
      shouldCountDealerProfileAddressChange({
        source: "SELF_SERVICE",
        previousSlug: "dealer-user-123",
        userId: "user-123",
      }),
    ).toBe(false);
    expect(
      shouldCountDealerProfileAddressChange({
        source: "SYSTEM",
        previousSlug: "dealer-one",
        userId: "user-123",
      }),
    ).toBe(false);
    expect(
      shouldCountDealerProfileAddressChange({
        source: "SELF_SERVICE",
        previousSlug: "dealer-one",
        userId: "user-123",
      }),
    ).toBe(true);
  });
});
