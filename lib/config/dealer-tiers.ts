import type { DealerTier } from "@prisma/client";

export const DEALER_TIER_CAPS: Record<DealerTier, number> = {
  STARTER: 10,
  PRO: 30,
};

export const DEALER_TIER_LABELS: Record<DealerTier, string> = {
  STARTER: "Starter",
  PRO: "Pro",
};

export function getDealerListingCap(tier: DealerTier | null | undefined): number {
  return DEALER_TIER_CAPS[tier ?? "STARTER"];
}

export function getDealerStripePriceId(tier: DealerTier): string {
  if (tier === "PRO") {
    const proPriceId = process.env.STRIPE_DEALER_PRO_PRICE_ID;
    if (!proPriceId) {
      throw new Error("STRIPE_DEALER_PRO_PRICE_ID is not set");
    }
    return proPriceId;
  }

  const starterPriceId =
    process.env.STRIPE_DEALER_STARTER_PRICE_ID ?? process.env.STRIPE_DEALER_PRICE_ID;
  if (!starterPriceId) {
    throw new Error(
      "STRIPE_DEALER_STARTER_PRICE_ID (or STRIPE_DEALER_PRICE_ID) is not set"
    );
  }
  return starterPriceId;
}

export function getDealerTierFromPriceId(priceId: string | null | undefined): DealerTier {
  if (!priceId) return "STARTER";
  const proPriceId = process.env.STRIPE_DEALER_PRO_PRICE_ID;
  if (proPriceId && priceId === proPriceId) return "PRO";

  const starterPriceId =
    process.env.STRIPE_DEALER_STARTER_PRICE_ID ?? process.env.STRIPE_DEALER_PRICE_ID;
  if (starterPriceId && priceId === starterPriceId) return "STARTER";

  return "STARTER";
}
