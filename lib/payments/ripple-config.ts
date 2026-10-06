import type { DealerTier } from "@prisma/client";

export type RippleCheckoutType =
  | "listing_payment"
  | "listing_and_featured"
  | "listing_support"
  | "featured_upgrade"
  | "dealer_subscription";

export const RIPPLE_CANONICAL_PRODUCTS = {
  listing: {
    key: "listing",
    code: "74A7510E33E94821",
    amountPence: 499,
    checkoutType: "listing_payment" as const,
    envUrlKey: "RIPPLE_LISTING_PAYMENT_URL",
  },
  listingAndFeatured: {
    key: "listing-and-featured",
    code: "9AFE8E93CD3145D3",
    amountPence: 999,
    checkoutType: "listing_and_featured" as const,
    envUrlKey: "RIPPLE_LISTING_AND_FEATURED_PAYMENT_URL",
  },
  featured: {
    key: "featured",
    code: "1BB714D5DBC446B6",
    amountPence: 500,
    checkoutType: "featured_upgrade" as const,
    envUrlKey: "RIPPLE_FEATURED_PAYMENT_URL",
  },
  starter: {
    key: "starter",
    code: "8181FAC1359E413E",
    amountPence: 2999,
    checkoutType: "dealer_subscription" as const,
    tier: "STARTER" as const,
    envUrlKey: "RIPPLE_DEALER_STARTER_URL",
  },
  pro: {
    key: "pro",
    code: "C5D44F6F18094B94",
    amountPence: 4999,
    checkoutType: "dealer_subscription" as const,
    tier: "PRO" as const,
    envUrlKey: "RIPPLE_DEALER_PRO_URL",
  },
} as const;

export type RippleProductKey = keyof typeof RIPPLE_CANONICAL_PRODUCTS;

export type RippleTestSubscriptionProduct = {
  key: "weekly-test";
  code: string;
  amountPence: 100;
  checkoutType: "dealer_subscription";
  tier: "STARTER";
  billingInterval: "week";
  envUrlKey: "RIPPLE_TEST_SUBSCRIPTION_URL";
};

/** Exact Ripple package title of the dedicated £1 weekly staging link. */
export const RIPPLE_WEEKLY_TEST_PACKAGE_NAME = "test subscription link";

export function isRippleWeeklyTestPackageName(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === RIPPLE_WEEKLY_TEST_PACKAGE_NAME;
}

export type RippleProduct = (typeof RIPPLE_CANONICAL_PRODUCTS)[RippleProductKey]
  | RippleTestSubscriptionProduct
  | { key: "featured-test"; code: string; amountPence: 50; checkoutType: "featured_upgrade"; envUrlKey: "RIPPLE_TEST_FEATURED_URL" };

export const RIPPLE_PAYMENT_ORIGIN = "https://portal.startyourripple.co.uk";

export function isRipplePreviewRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview" ||
    (!env.VERCEL_ENV && env.NODE_ENV === "development" && env.RIPPLE_ENABLE_LOCAL_TEST_PLANS === "1");
}

function getTestLinkCode(key: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[key]?.trim();
  if (!value) return null;
  const code = extractRippleLinkCode(value);
  if (!code || Object.values(RIPPLE_CANONICAL_PRODUCTS).some((product) => product.code === code)) {
    throw new Error(`${key} must use a dedicated test payment link`);
  }
  const otherKey = key === "RIPPLE_TEST_SUBSCRIPTION_URL"
    ? "RIPPLE_TEST_FEATURED_URL" : "RIPPLE_TEST_SUBSCRIPTION_URL";
  const otherUrl = env[otherKey];
  if (otherUrl && extractRippleLinkCode(otherUrl) === code) {
    throw new Error("Ripple staging products must use separate payment links");
  }
  const url = new URL(value);
  if (url.origin !== RIPPLE_PAYMENT_ORIGIN || url.username || url.password || url.port ||
    url.pathname !== `/card/${getRippleClientId(env)}/pay/${code}`) {
    throw new Error(`${key} must use the canonical Ripple origin and client`);
  }
  return code;
}

/** Routing can recognise this product in production without granting its entitlements. */
export function getConfiguredRippleTestSubscriptionProduct(env: NodeJS.ProcessEnv = process.env): RippleTestSubscriptionProduct | null {
  const code = getTestLinkCode("RIPPLE_TEST_SUBSCRIPTION_URL", env);
  return code ? { key: "weekly-test", code, amountPence: 100, checkoutType: "dealer_subscription", tier: "STARTER", billingInterval: "week", envUrlKey: "RIPPLE_TEST_SUBSCRIPTION_URL" } : null;
}

export function getRippleTestSubscriptionProduct(env: NodeJS.ProcessEnv = process.env): RippleTestSubscriptionProduct | null {
  return isRipplePreviewRuntime(env) ? getConfiguredRippleTestSubscriptionProduct(env) : null;
}

export function getRippleTestFeaturedProduct(env: NodeJS.ProcessEnv = process.env): RippleProduct | null {
  if (!isRipplePreviewRuntime(env)) return null;
  try {
    const code = getTestLinkCode("RIPPLE_TEST_FEATURED_URL", env);
    return code ? { key: "featured-test", code, amountPence: 50, checkoutType: "featured_upgrade", envUrlKey: "RIPPLE_TEST_FEATURED_URL" } : null;
  } catch {
    // Featured controls are optional; missing or stale preview configuration
    // must not make production pages that render them fail.
    return null;
  }
}

export function isRippleStagingLinkCode(code: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!code) return false;
  const normalizedCode = code.trim().toUpperCase();
  return ["RIPPLE_TEST_SUBSCRIPTION_URL", "RIPPLE_TEST_FEATURED_URL"]
    .some((key) => {
      try {
        return getTestLinkCode(key, env) === normalizedCode;
      } catch {
        // Classification runs while applying verified production webhooks.
        // Invalid optional preview configuration must be treated as non-matching.
        return false;
      }
    });
}

export function getTrimmedEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

export function isRippleLiveCheckoutEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.RIPPLE_LIVE_CHECKOUT_ENABLED === "1";
}

export function isNonProductionRuntime(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.NODE_ENV !== "production";
}

export function assertRippleHostedCheckoutAvailable(
  env: NodeJS.ProcessEnv = process.env
) {
  // Retiring new test checkouts must not disable recognition of existing renewals.
  if (isRipplePreviewRuntime(env)) throw new Error("RIPPLE_PREVIEW_CHECKOUT_DISABLED");
  if (isRippleLiveCheckoutEnabled(env)) return;
  if (isNonProductionRuntime(env)) return;
  throw new Error("RIPPLE_LIVE_CHECKOUT_ENABLED");
}

export function getRippleClientId(env: NodeJS.ProcessEnv = process.env): string {
  const clientId = env.RIPPLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("RIPPLE_CLIENT_ID is not set");
  }
  return clientId;
}

export function getRippleWebhookSecret(
  env: NodeJS.ProcessEnv = process.env
): string {
  const secret = env.RIPPLE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("RIPPLE_WEBHOOK_SECRET is not set");
  }
  return secret;
}

export function getRippleReferenceSecrets(
  env: NodeJS.ProcessEnv = process.env
): { current: string; previous: string | null } {
  const current = env.RIPPLE_REFERENCE_SECRET?.trim();
  if (!current || current.length < 32) {
    throw new Error("RIPPLE_REFERENCE_SECRET must be a 256-bit secret");
  }
  return {
    current,
    previous: env.RIPPLE_REFERENCE_SECRET_PREVIOUS?.trim() || null,
  };
}

export function extractRippleLinkCode(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/pay\/([A-Fa-f0-9]{16,})$/);
    return match?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

export function getConfiguredRippleProductUrl(
  product: RippleProduct,
  env: NodeJS.ProcessEnv = process.env
): string {
  const url = env[product.envUrlKey]?.trim();
  if (!url) {
    throw new Error(`${product.envUrlKey} is not set`);
  }
  const code = extractRippleLinkCode(url);
  if (code !== product.code) {
    throw new Error(`${product.envUrlKey} must use payment link ${product.code}`);
  }
  const clientId = getRippleClientId(env);
  const parsed = new URL(url);
  if (
    parsed.origin !== RIPPLE_PAYMENT_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error(`${product.envUrlKey} must use the canonical Ripple origin`);
  }
  const expectedPath = `/card/${clientId}/pay/${product.code}`;
  if (parsed.pathname !== expectedPath) {
    throw new Error(`${product.envUrlKey} must use client ${clientId}`);
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function getRippleProductByCheckoutType(
  checkoutType: RippleCheckoutType,
  tier?: DealerTier
): RippleProduct {
  if (checkoutType === "listing_payment") return RIPPLE_CANONICAL_PRODUCTS.listing;
  if (checkoutType === "listing_and_featured") return RIPPLE_CANONICAL_PRODUCTS.listingAndFeatured;
  if (checkoutType === "featured_upgrade") return RIPPLE_CANONICAL_PRODUCTS.featured;
  if (checkoutType === "dealer_subscription") {
    return tier === "PRO"
      ? RIPPLE_CANONICAL_PRODUCTS.pro
      : RIPPLE_CANONICAL_PRODUCTS.starter;
  }
  throw new Error("Optional listing support is not configured for Ripple");
}

export function assertRippleAmountMatchesProduct(
  product: RippleProduct,
  amountPence: number | null | undefined
) {
  if (amountPence !== product.amountPence) {
    throw new Error(
      `Ripple ${product.key} amount must be ${product.amountPence} pence`
    );
  }
}
