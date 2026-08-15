import { beforeEach, describe, expect, it } from "vitest";
import { MARKETPLACE_PRICING } from "@/lib/config/marketplace-pricing-definitions";
import {
  assertRippleHostedCheckoutAvailable,
  getConfiguredRippleProductUrl,
  RIPPLE_CANONICAL_PRODUCTS,
} from "@/lib/payments/ripple-config";
import {
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
  createListingCheckout,
} from "@/lib/payments/provider";
import { parseRippleReference } from "@/lib/payments/ripple-reference";
import { installRippleTestEnv } from "./ripple-test-env";

describe("RIP-PRICE-001 fixed Ripple checkout URLs", () => {
  beforeEach(() => {
    installRippleTestEnv();
  });

  it("appends only a signed reference to the listing payment link", async () => {
    const result = await createListingCheckout({
      listingId: "listing-1",
      listingTitle: "Test",
      amountInPence: 499,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe(
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`
    );
    expect([...url.searchParams.keys()]).toEqual(["reference"]);
    expect(
      parseRippleReference(
        url.searchParams.get("reference"),
        RIPPLE_CANONICAL_PRODUCTS.listing.code
      )?.targetId
    ).toBe("listing-1");
  });

  it("rejects new listing support checkout POL-PAY-001", async () => {
    await expect(
      createListingCheckout({
        listingId: "listing-1",
        listingTitle: "Test",
        amountInPence: 500,
        checkoutType: "listing_support",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    ).rejects.toThrow("RIPPLE_LISTING_SUPPORT_URL");
  });

  it("rejects checkout amount drift", async () => {
    await expect(
      createFeaturedUpgradeCheckout({
        listingId: "listing-1",
        listingTitle: "Test",
        amountInPence: 875,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      })
    ).rejects.toThrow("amount must be 500 pence");
  });

  it("builds dealer links from the recurring payment codes", async () => {
    const starter = await createDealerSubscriptionCheckout({
      dealerId: "dealer-1",
      tier: "STARTER",
      amountInPence: 2999,
      customerEmail: "dealer@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(starter.url).toContain(RIPPLE_CANONICAL_PRODUCTS.starter.code);
  });

  it("keeps Admin Site Settings defaults aligned with the four fixed Ripple amounts", () => {
    expect(MARKETPLACE_PRICING.privateListing.defaultPence).toBe(
      RIPPLE_CANONICAL_PRODUCTS.listing.amountPence
    );
    expect(MARKETPLACE_PRICING.featuredUpgrade.defaultPence).toBe(
      RIPPLE_CANONICAL_PRODUCTS.featured.amountPence
    );
    expect(MARKETPLACE_PRICING.dealerStarterMonthly.defaultPence).toBe(
      RIPPLE_CANONICAL_PRODUCTS.starter.amountPence
    );
    expect(MARKETPLACE_PRICING.dealerProMonthly.defaultPence).toBe(
      RIPPLE_CANONICAL_PRODUCTS.pro.amountPence
    );
  });

  it("rejects a live checkout URL that uses the wrong Ripple client", () => {
    process.env.RIPPLE_LISTING_PAYMENT_URL = `https://portal.startyourripple.co.uk/card/demo-gym/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`;
    expect(() =>
      getConfiguredRippleProductUrl(RIPPLE_CANONICAL_PRODUCTS.listing)
    ).toThrow(/must use client/);
  });

  it("accepts only the canonical HTTPS Ripple payment origin RIP-URL-001", () => {
    const code = RIPPLE_CANONICAL_PRODUCTS.listing.code;
    for (const invalidUrl of [
      `http://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`,
      `https://example.com/card/codelabplatfdcf3a8/pay/${code}`,
      `https://portal.startyourripple.co.uk:8443/card/codelabplatfdcf3a8/pay/${code}`,
      `https://user@portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`,
      `https://portal.startyourripple.co.uk/extra/card/codelabplatfdcf3a8/pay/${code}`,
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}/extra`,
    ]) {
      process.env.RIPPLE_LISTING_PAYMENT_URL = invalidUrl;
      expect(() =>
        getConfiguredRippleProductUrl(RIPPLE_CANONICAL_PRODUCTS.listing),
      ).toThrow();
    }

    process.env.RIPPLE_LISTING_PAYMENT_URL =
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}?ignored=1`;
    expect(
      getConfiguredRippleProductUrl(RIPPLE_CANONICAL_PRODUCTS.listing),
    ).toBe(
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`,
    );
  });

  it("blocks hosted checkout when live checkout is disabled in production", () => {
    expect(() =>
      assertRippleHostedCheckoutAvailable({
        NODE_ENV: "production",
      })
    ).toThrow("RIPPLE_LIVE_CHECKOUT_ENABLED");
    expect(() =>
      assertRippleHostedCheckoutAvailable({
        NODE_ENV: "production",
        RIPPLE_LIVE_CHECKOUT_ENABLED: "1",
      })
    ).not.toThrow();
    expect(() =>
      assertRippleHostedCheckoutAvailable({
        NODE_ENV: "test",
      })
    ).not.toThrow();
  });
});
