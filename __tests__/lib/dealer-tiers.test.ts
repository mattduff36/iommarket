import { describe, expect, it } from "vitest";
import {
  DEALER_TIER_CAPS,
  getDealerListingCap,
  getDealerListingCapFeature,
} from "@/lib/config/dealer-tiers";

describe("dealer listing caps", () => {
  it("locks Starter at 30 and Pro at 100", () => {
    expect(DEALER_TIER_CAPS).toEqual({
      STARTER: 30,
      PRO: 100,
    });
  });

  it("returns the Starter cap for Starter and missing tiers", () => {
    expect(getDealerListingCap("STARTER")).toBe(30);
    expect(getDealerListingCap(null)).toBe(30);
    expect(getDealerListingCap(undefined)).toBe(30);
  });

  it("returns the Pro cap for Pro", () => {
    expect(getDealerListingCap("PRO")).toBe(100);
  });

  it("builds advertised listing-cap copy from the same numbers", () => {
    expect(getDealerListingCapFeature("STARTER")).toBe(
      "Up to 30 active listings",
    );
    expect(getDealerListingCapFeature("PRO")).toBe("Up to 100 active listings");
  });
});
