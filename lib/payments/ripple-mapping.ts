import type { DealerTier } from "@prisma/client";
import {
  RIPPLE_CANONICAL_PRODUCTS,
  type RippleProduct,
} from "@/lib/payments/ripple-config";

const STARTER_PACKAGE_ALIASES = new Set([
  "dealer starter subscription",
  "itrader.im dealer starter subscription",
  "dealer starter",
  "starter",
  RIPPLE_CANONICAL_PRODUCTS.starter.code.toLowerCase(),
]);

const PRO_PACKAGE_ALIASES = new Set([
  "dealer pro subscription",
  "itrader.im dealer pro subscription",
  "dealer pro",
  "pro",
  RIPPLE_CANONICAL_PRODUCTS.pro.code.toLowerCase(),
]);

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

export function getRippleProductByLinkCode(
  linkCode: string | null | undefined
): RippleProduct | null {
  if (!linkCode) return null;
  const normalized = linkCode.trim().toUpperCase();
  return (
    Object.values(RIPPLE_CANONICAL_PRODUCTS).find(
      (product) => product.code === normalized
    ) ?? null
  );
}

export function getRippleProductByPackageName(
  packageName: string | null | undefined
): RippleProduct | null {
  if (!packageName) return null;
  const normalized = normalizeAlias(packageName);
  if (PRO_PACKAGE_ALIASES.has(normalized)) {
    return RIPPLE_CANONICAL_PRODUCTS.pro;
  }
  if (STARTER_PACKAGE_ALIASES.has(normalized)) {
    return RIPPLE_CANONICAL_PRODUCTS.starter;
  }
  return null;
}

export function resolveRippleProduct(input: {
  linkCode?: string | null;
  packageName?: string | null;
}): RippleProduct | null {
  if (input.linkCode?.trim()) {
    return getRippleProductByLinkCode(input.linkCode);
  }
  return getRippleProductByPackageName(input.packageName);
}

export function getDealerTierFromRippleProduct(
  product: RippleProduct | null
): DealerTier | null {
  if (!product || product.checkoutType !== "dealer_subscription") return null;
  return "tier" in product ? product.tier : null;
}

export function getDealerTierFromProviderPlanId(
  planId: string | null | undefined
): DealerTier | null {
  const product =
    getRippleProductByLinkCode(planId) ?? getRippleProductByPackageName(planId);
  return getDealerTierFromRippleProduct(product);
}
