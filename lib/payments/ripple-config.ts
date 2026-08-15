import type { DealerTier } from "@prisma/client";

export type RippleCheckoutType =
  | "listing_payment"
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

export type RippleProduct = (typeof RIPPLE_CANONICAL_PRODUCTS)[RippleProductKey];

const RIPPLE_PAYMENT_ORIGIN = "https://portal.startyourripple.co.uk";

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
