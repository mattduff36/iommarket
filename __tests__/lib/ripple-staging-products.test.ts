import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredRippleTestSubscriptionProduct,
  getRippleTestSubscriptionProduct,
  getRippleTestFeaturedProduct,
  getRippleProductByCheckoutType,
  getConfiguredRippleProductUrl,
  isRippleStagingLinkCode,
  RIPPLE_CANONICAL_PRODUCTS,
} from "@/lib/payments/ripple-config";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import { addRippleBillingPeriod } from "@/lib/payments/ripple-calendar";
import { createDealerSubscriptionCheckout, createFeaturedUpgradeCheckout, createListingCheckout } from "@/lib/payments/provider";

const code = "ABCDEF0123456789";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production", VERCEL_ENV: "preview", RIPPLE_CLIENT_ID: "test-client",
  RIPPLE_TEST_SUBSCRIPTION_URL: `https://portal.startyourripple.co.uk/card/test-client/pay/${code}`,
};

afterEach(() => vi.unstubAllEnvs());

describe("isolated weekly staging subscription", () => {
  it("recognises routing in production but cannot grant production access", () => {
    const production = { ...env, VERCEL_ENV: "production" };
    expect(isRippleStagingLinkCode(code, production)).toBe(true);
    expect(getRippleTestSubscriptionProduct(production)).toBeNull();
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
    expect(getRippleProductByLinkCode(code)).toBeNull();
  });

  it("requires the exact provider origin, client and a distinct test link", () => {
    for (const url of [
      `https://evil.example/card/test-client/pay/${code}`,
      `https://portal.startyourripple.co.uk/card/other-client/pay/${code}`,
      `https://portal.startyourripple.co.uk/card/test-client/pay/${RIPPLE_CANONICAL_PRODUCTS.starter.code}`,
    ]) {
      expect(() => getConfiguredRippleTestSubscriptionProduct({ ...env, RIPPLE_TEST_SUBSCRIPTION_URL: url })).toThrow();
    }
  });

  it("uses seven days across month and DST boundaries; real plans remain monthly", () => {
    const product = getRippleTestSubscriptionProduct(env)!;
    expect(addRippleBillingPeriod(new Date("2026-10-24T12:00:00Z"), product).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(addRippleBillingPeriod(new Date("2026-01-31T12:00:00Z"), RIPPLE_CANONICAL_PRODUCTS.starter).toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });

  it("restores standard featured pricing while retaining test receipt recognition on preview", () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const featuredCode = "1234567890ABCDEF";
    vi.stubEnv("RIPPLE_TEST_FEATURED_URL", `https://portal.startyourripple.co.uk/card/test-client/pay/${featuredCode}`);
    expect(getRippleProductByCheckoutType("featured_upgrade")).toEqual(RIPPLE_CANONICAL_PRODUCTS.featured);
    expect(getRippleProductByLinkCode(featuredCode)).toMatchObject({ code: featuredCode, amountPence: 50 });
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getRippleProductByCheckoutType("featured_upgrade")).toEqual(RIPPLE_CANONICAL_PRODUCTS.featured);
    expect(getRippleProductByLinkCode(featuredCode)).toBeNull();
    expect(isRippleStagingLinkCode(featuredCode)).toBe(true);
  });

  it("hides the optional featured test product when preview configuration is missing or invalid", () => {
    const featuredCode = "1234567890ABCDEF";
    const previewEnv: NodeJS.ProcessEnv = {
      ...env,
      RIPPLE_TEST_FEATURED_URL: `https://portal.startyourripple.co.uk/card/test-client/pay/${featuredCode}`,
    };
    const missingClient: NodeJS.ProcessEnv = { ...previewEnv };
    delete missingClient.RIPPLE_CLIENT_ID;

    expect(getRippleTestFeaturedProduct(missingClient)).toBeNull();
    expect(getRippleProductByCheckoutType("featured_upgrade", undefined)).toEqual(RIPPLE_CANONICAL_PRODUCTS.featured);
    expect(getRippleTestFeaturedProduct({
      ...previewEnv,
      RIPPLE_TEST_FEATURED_URL: `https://portal.startyourripple.co.uk/card/other-client/pay/${featuredCode}`,
    })).toBeNull();
    expect(() => getConfiguredRippleProductUrl(RIPPLE_CANONICAL_PRODUCTS.featured, {
      NODE_ENV: "production",
      RIPPLE_FEATURED_PAYMENT_URL: `https://portal.startyourripple.co.uk/card/test-client/pay/${RIPPLE_CANONICAL_PRODUCTS.featured.code}`,
    })).toThrow("RIPPLE_CLIENT_ID is not set");
  });

  it("treats malformed optional preview links as non-matching during production routing", () => {
    const featuredCode = "1234567890ABCDEF";
    const production: NodeJS.ProcessEnv = {
      ...env,
      VERCEL_ENV: "production",
      RIPPLE_TEST_FEATURED_URL: `https://portal.startyourripple.co.uk/card/other-client/pay/${featuredCode}`,
    };

    expect(isRippleStagingLinkCode(code, production)).toBe(true);
    expect(isRippleStagingLinkCode(featuredCode, production)).toBe(false);
    expect(isRippleStagingLinkCode(featuredCode, {
      ...production,
      RIPPLE_TEST_SUBSCRIPTION_URL: "not-a-url",
      RIPPLE_TEST_FEATURED_URL: `https://portal.startyourripple.co.uk/card/test-client/pay/${featuredCode}`,
    })).toBe(true);
  });

  it("rejects reusing one test link for both product types", () => {
    expect(() => getRippleTestSubscriptionProduct({ ...env, RIPPLE_TEST_FEATURED_URL: env.RIPPLE_TEST_SUBSCRIPTION_URL })).toThrow("separate payment links");
  });

  it("blocks all new preview payments while retaining the existing weekly product for renewals", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("RIPPLE_LIVE_CHECKOUT_ENABLED", "1");
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", "staging-reference-secret-long-enough-for-test");
    const payer = { dealerName: null, accountName: null, email: "test@example.com" };
    const input = { dealerId: "dealer-1", tier: "STARTER" as const, testPlan: true, amountInPence: 100, payer, successUrl: "https://preview.example/success", cancelUrl: "https://preview.example/cancel" };
    await expect(createDealerSubscriptionCheckout(input)).rejects.toThrow("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
    await expect(createDealerSubscriptionCheckout({ ...input, testPlan: false, amountInPence: 2999 })).rejects.toThrow("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
    const listing = { listingId: "listing-1", listingTitle: "Test", payer, successUrl: input.successUrl, cancelUrl: input.cancelUrl };
    await expect(createFeaturedUpgradeCheckout({ ...listing, amountInPence: 50 })).rejects.toThrow("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
    await expect(createFeaturedUpgradeCheckout({ ...listing, amountInPence: 500 })).rejects.toThrow("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
    await expect(createListingCheckout({ ...listing, amountInPence: 499 })).rejects.toThrow("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
    expect(getRippleProductByLinkCode(code)).toMatchObject({ amountPence: 100, billingInterval: "week" });
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(createDealerSubscriptionCheckout(input)).rejects.toThrow("only available on preview");
  });
});
