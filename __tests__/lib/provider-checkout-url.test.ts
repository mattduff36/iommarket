import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MARKETPLACE_PRICING } from "@/lib/config/marketplace-pricing-definitions";
import {
  assertRippleHostedCheckoutAvailable,
  getConfiguredRippleProductUrl,
  RIPPLE_CANONICAL_PRODUCTS,
} from "@/lib/payments/ripple-config";
import {
  getRippleCustomerDetails,
  isRippleSkipDetailsEnabled,
  type RippleCheckoutPayer,
} from "@/lib/payments/ripple-customer-details";
import {
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
  createListingAndFeaturedCheckout,
  createListingCheckout,
} from "@/lib/payments/provider";
import { parseRippleReference } from "@/lib/payments/ripple-reference";
import { installRippleTestEnv } from "./ripple-test-env";

const payer = (overrides: Partial<RippleCheckoutPayer> = {}): RippleCheckoutPayer => ({
  dealerName: null,
  accountName: "Ada Lovelace",
  email: "ada@example.com",
  ...overrides,
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") return [];
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("RIP-PRICE-001 fixed Ripple checkout URLs", () => {
  beforeEach(() => {
    installRippleTestEnv();
    delete process.env.RIPPLE_SKIP_DETAILS_ENABLED;
    delete process.env.VERCEL_ENV;
  });

  it("appends only a signed reference to the listing payment link", async () => {
    process.env.RIPPLE_SKIP_DETAILS_ENABLED = "0";
    const result = await createListingCheckout({
      listingId: "listing-1",
      listingTitle: "Test",
      amountInPence: 499,
      payer: payer(),
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe(
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${RIPPLE_CANONICAL_PRODUCTS.listing.code}`
    );
    expect([...url.searchParams.keys()]).toEqual(["reference"]);
    expect(url.pathname).not.toContain("embed-signup");
    expect(
      parseRippleReference(
        url.searchParams.get("reference"),
        RIPPLE_CANONICAL_PRODUCTS.listing.code
      )?.targetId
    ).toBe("listing-1");
  });

  it("adds the dealer name on production and keeps the Ripple payment link", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.RIPPLE_LISTING_AND_FEATURED_PAYMENT_URL =
      `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${RIPPLE_CANONICAL_PRODUCTS.listingAndFeatured.code}`;
    const checkoutPayer = payer({
      dealerName: "  A1 Motors & Sons  ",
      accountName: "Zoë O'Neil",
      email: " zoe+listing@example.com ",
    });
    const shared = {
      payer: checkoutPayer,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    };
    const results = await Promise.all([
      createListingCheckout({
        listingId: "listing-encoded",
        listingTitle: "Test",
        amountInPence: 499,
        ...shared,
      }),
      createListingAndFeaturedCheckout({
        listingId: "listing-encoded",
        listingTitle: "Test",
        amountInPence: 999,
        ...shared,
      }),
      createFeaturedUpgradeCheckout({
        listingId: "listing-encoded",
        listingTitle: "Test",
        amountInPence: 500,
        ...shared,
      }),
      createDealerSubscriptionCheckout({
        dealerId: "dealer-1",
        tier: "STARTER",
        amountInPence: 2999,
        ...shared,
      }),
      createDealerSubscriptionCheckout({
        dealerId: "dealer-1",
        tier: "PRO",
        amountInPence: 4999,
        ...shared,
      }),
    ]);
    for (const result of results) {
      const url = new URL(result.url);
      expect(url.origin).toBe("https://portal.startyourripple.co.uk");
      expect(url.pathname).toMatch(/\/card\/codelabplatfdcf3a8\/pay\/[A-F0-9]+$/);
      expect(url.searchParams.get("name")).toBe("A1 Motors & Sons");
      expect(url.searchParams.get("email")).toBe("zoe+listing@example.com");
      expect(url.href).toContain("name=A1+Motors+%26+Sons");
      expect([...url.searchParams.keys()]).toEqual(["reference", "name", "email"]);
    }
    expect(parseRippleReference(
      new URL(results[0].url).searchParams.get("reference"),
      RIPPLE_CANONICAL_PRODUCTS.listing.code,
    )?.targetId).toBe("listing-encoded");
  });

  it("uses the account name when the business name is unusable", async () => {
    process.env.RIPPLE_SKIP_DETAILS_ENABLED = "1";
    const result = await createListingCheckout({
      listingId: "listing-account-name",
      listingTitle: "Test",
      amountInPence: 499,
      payer: payer({ dealerName: "A\n1", accountName: "  Zoë O'Neil  " }),
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(new URL(result.url).searchParams.get("name")).toBe("Zoë O'Neil");
  });

  it("omits customer details when the bypass is off or either value is unusable", async () => {
    const create = (checkoutPayer: RippleCheckoutPayer) =>
      createListingCheckout({
        listingId: "listing-no-details",
        listingTitle: "Test",
        amountInPence: 499,
        payer: checkoutPayer,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });

    process.env.VERCEL_ENV = "production";
    process.env.RIPPLE_SKIP_DETAILS_ENABLED = "0";
    expect([...(new URL((await create(payer())).url)).searchParams.keys()]).toEqual(["reference"]);

    delete process.env.VERCEL_ENV;
    process.env.RIPPLE_SKIP_DETAILS_ENABLED = "1";
    for (const checkoutPayer of [
      payer({ dealerName: "A", accountName: "B" }),
      payer({ email: "not-an-email" }),
      payer({ dealerName: null, accountName: null }),
    ]) {
      const url = new URL((await create(checkoutPayer)).url);
      expect([...url.searchParams.keys()]).toEqual(["reference"]);
    }
  });

  it("keeps preview and local details off unless the flag is on", () => {
    const checkoutPayer = payer({ dealerName: "Island Motors" });
    const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
      ({ NODE_ENV: "test", ...values });
    expect(isRippleSkipDetailsEnabled(env({ VERCEL_ENV: "preview" }))).toBe(false);
    expect(isRippleSkipDetailsEnabled(env({}))).toBe(false);
    expect(getRippleCustomerDetails(checkoutPayer, false)).toBeNull();
    expect(isRippleSkipDetailsEnabled(env({ VERCEL_ENV: "production" }))).toBe(true);
    expect(isRippleSkipDetailsEnabled(env({
      VERCEL_ENV: "production",
      RIPPLE_SKIP_DETAILS_ENABLED: "0",
    }))).toBe(false);
    expect(getRippleCustomerDetails(checkoutPayer, isRippleSkipDetailsEnabled(env({
      VERCEL_ENV: "preview",
      RIPPLE_SKIP_DETAILS_ENABLED: "1",
    })))).toEqual({ name: "Island Motors", email: "ada@example.com" });
  });

  it("rejects new listing support checkout POL-PAY-001", async () => {
    await expect(
      createListingCheckout({
        listingId: "listing-1",
        listingTitle: "Test",
        amountInPence: 500,
        checkoutType: "listing_support",
        payer: payer(),
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
        payer: payer(),
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      })
    ).rejects.toThrow("amount must be 500 pence");
  });

  it("keeps featured upgrades on hosted /pay links instead of dealer embed-signup", async () => {
    const result = await createFeaturedUpgradeCheckout({
      listingId: "listing-1",
      listingTitle: "Test",
      amountInPence: 500,
      payer: payer(),
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    const url = new URL(result.url);
    expect(url.pathname).toBe(
      `/card/codelabplatfdcf3a8/pay/${RIPPLE_CANONICAL_PRODUCTS.featured.code}`,
    );
    expect(url.pathname).not.toContain("embed-signup");
    expect([...url.searchParams.keys()]).toEqual(["reference"]);
  });

  it("builds dealer links from the recurring payment codes", async () => {
    const starter = await createDealerSubscriptionCheckout({
      dealerId: "dealer-1",
      tier: "STARTER",
      amountInPence: 2999,
      payer: payer({ email: "dealer@example.com" }),
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

  it("writes the Ripple name and email only inside the shared checkout builder", () => {
    const setter = /searchParams\.set\(\s*["'](?:name|email)["']/;
    const offenders = ["lib", "actions", "app", "components"].flatMap(sourceFiles).filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      if (normalized.endsWith("lib/payments/provider.ts")) return false;
      return setter.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);

    const source = readFileSync(join(process.cwd(), "lib/payments/provider.ts"), "utf8");
    const hosted = source.split("export async function ").slice(1).filter((chunk) =>
      chunk.includes("buildFixedCheckoutUrl(")
    );
    expect(hosted.length).toBeGreaterThanOrEqual(4);
    for (const chunk of hosted) {
      expect(chunk.slice(0, chunk.indexOf("buildFixedCheckoutUrl("))).toContain("payer: RippleCheckoutPayer");
      expect(chunk).toContain("payer: params.payer");
    }
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
