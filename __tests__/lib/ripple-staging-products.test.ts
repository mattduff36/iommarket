import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredRippleTestSubscriptionProduct,
  getRippleTestSubscriptionProduct,
  getRippleProductByCheckoutType,
  isRippleStagingLinkCode,
  RIPPLE_CANONICAL_PRODUCTS,
} from "@/lib/payments/ripple-config";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import { addRippleBillingPeriod } from "@/lib/payments/ripple-calendar";
import { createDealerSubscriptionCheckout } from "@/lib/payments/provider";

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

  it("uses the dedicated 50p featured link only on preview", () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const featuredCode = "1234567890ABCDEF";
    vi.stubEnv("RIPPLE_TEST_FEATURED_URL", `https://portal.startyourripple.co.uk/card/test-client/pay/${featuredCode}`);
    expect(getRippleProductByCheckoutType("featured_upgrade")).toMatchObject({ code: featuredCode, amountPence: 50 });
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getRippleProductByCheckoutType("featured_upgrade")).toEqual(RIPPLE_CANONICAL_PRODUCTS.featured);
    expect(getRippleProductByLinkCode(featuredCode)).toBeNull();
    expect(isRippleStagingLinkCode(featuredCode)).toBe(true);
  });

  it("rejects reusing one test link for both product types", () => {
    expect(() => getRippleTestSubscriptionProduct({ ...env, RIPPLE_TEST_FEATURED_URL: env.RIPPLE_TEST_SUBSCRIPTION_URL })).toThrow("separate payment links");
  });

  it("creates the £1 dedicated checkout only on preview and rejects the wrong amount", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("RIPPLE_LIVE_CHECKOUT_ENABLED", "1");
    vi.stubEnv("RIPPLE_REFERENCE_SECRET", "staging-reference-secret-long-enough-for-test");
    const input = { dealerId: "dealer-1", tier: "STARTER" as const, testPlan: true, amountInPence: 100, customerEmail: "test@example.com", successUrl: "https://preview.example/success", cancelUrl: "https://preview.example/cancel" };
    expect((await createDealerSubscriptionCheckout(input)).url).toContain(`/pay/${code}?reference=`);
    await expect(createDealerSubscriptionCheckout({ ...input, testPlan: false, amountInPence: 2999 })).rejects.toThrow("RIPPLE_STAGING_LINK_REQUIRED");
    await expect(createDealerSubscriptionCheckout({ ...input, amountInPence: 2999 })).rejects.toThrow("100 pence");
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(createDealerSubscriptionCheckout(input)).rejects.toThrow("only available on preview");
  });
});
