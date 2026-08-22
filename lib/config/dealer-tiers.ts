import type { DealerTier } from "@prisma/client";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { getDealerTierFromProviderPlanId as getTierFromRipplePlan } from "@/lib/payments/ripple-mapping";

export const DEALER_TIER_CAPS: Record<DealerTier, number> = {
  STARTER: 30,
  PRO: 100,
};

export const DEALER_TIER_LABELS: Record<DealerTier, string> = {
  STARTER: "Starter",
  PRO: "Pro",
};

export function getDealerListingCap(tier: DealerTier | null | undefined): number {
  return DEALER_TIER_CAPS[tier ?? "STARTER"];
}

export function getDealerListingCapFeature(tier: DealerTier): string {
  return `Up to ${getDealerListingCap(tier)} active listings`;
}

export function getDealerProviderPlanId(tier: DealerTier): string {
  return tier === "PRO"
    ? RIPPLE_CANONICAL_PRODUCTS.pro.code
    : RIPPLE_CANONICAL_PRODUCTS.starter.code;
}

export function getDealerTierFromProviderPlanId(
  planId: string | null | undefined
): DealerTier {
  return getTierFromRipplePlan(planId) ?? "STARTER";
}
