import { describe, expect, it } from "vitest";
import {
  buildPayForListingInput,
  featuredCheckoutTotalPence,
  shouldOfferFeaturedUpsell,
  shouldStartSeparateFeaturedCheckout,
} from "@/app/(public)/sell/featured-checkout";

describe("featured checkout contract", () => {
  it("offers Featured only before payment and when prices are known", () => {
    expect(
      shouldOfferFeaturedUpsell({
        skipCheckout: false,
        alreadyFeatured: false,
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
      }),
    ).toBe(true);
    expect(
      shouldOfferFeaturedUpsell({
        skipCheckout: true,
        alreadyFeatured: false,
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
      }),
    ).toBe(false);
    expect(
      shouldOfferFeaturedUpsell({
        skipCheckout: false,
        alreadyFeatured: true,
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
      }),
    ).toBe(false);
  });

  it("totals the listing fee and Featured only when both are due", () => {
    expect(
      featuredCheckoutTotalPence({
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
        listingFeeDue: true,
        includeFeatured: false,
      }),
    ).toBe(499);
    expect(
      featuredCheckoutTotalPence({
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
        listingFeeDue: true,
        includeFeatured: true,
      }),
    ).toBe(999);
    expect(
      featuredCheckoutTotalPence({
        listingFeePence: 499,
        featuredUpgradePricePence: 500,
        listingFeeDue: false,
        includeFeatured: true,
      }),
    ).toBe(500);
  });

  it("sends includeFeatured only with a listing fee", () => {
    expect(
      buildPayForListingInput({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
        includeFeatured: false,
        listingFeeDue: true,
      }),
    ).toEqual({
      listingId: "listing-1",
      privateSellerTermsAccepted: true,
    });
    expect(
      buildPayForListingInput({
        listingId: "listing-1",
        privateSellerTermsAccepted: true,
        includeFeatured: true,
        listingFeeDue: true,
      }),
    ).toEqual({
      listingId: "listing-1",
      privateSellerTermsAccepted: true,
      includeFeatured: true,
    });
    expect(
      buildPayForListingInput({
        listingId: "listing-1",
        includeFeatured: true,
        listingFeeDue: false,
      }),
    ).toEqual({ listingId: "listing-1" });
  });

  it("starts a separate Featured checkout after a skipped listing fee", () => {
    expect(
      shouldStartSeparateFeaturedCheckout({
        includeFeatured: true,
        listingFeeDue: false,
        skippedPayment: true,
      }),
    ).toBe(true);
    expect(
      shouldStartSeparateFeaturedCheckout({
        includeFeatured: true,
        listingFeeDue: true,
        skippedPayment: false,
      }),
    ).toBe(false);
    expect(
      shouldStartSeparateFeaturedCheckout({
        includeFeatured: true,
        listingFeeDue: false,
        skipCheckout: true,
        skippedPayment: true,
      }),
    ).toBe(false);
  });
});
