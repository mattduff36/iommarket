import type { DealerTier } from "@prisma/client";

export const DEALER_TIER_CAPS: Record<DealerTier, number> = {
  STARTER: 10,
  PRO: 30,
};

export const DEALER_TIER_LABELS: Record<DealerTier, string> = {
  STARTER: "Starter",
  PRO: "Pro",
};

const DEMO_STARTER_PLAN_ID = "ripple_demo_gym_starter_monthly";
const DEMO_PRO_PLAN_ID = "ripple_demo_gym_pro_monthly";

export function getDealerListingCap(tier: DealerTier | null | undefined): number {
  return DEALER_TIER_CAPS[tier ?? "STARTER"];
}

export function getDealerProviderPlanId(tier: DealerTier): string {
  if (tier === "PRO") {
    const proPlanId = process.env.RIPPLE_DEALER_PRO_PLAN_ID ?? DEMO_PRO_PLAN_ID;
    return proPlanId;
  }

  const starterPlanId =
    process.env.RIPPLE_DEALER_STARTER_PLAN_ID ?? DEMO_STARTER_PLAN_ID;
  return starterPlanId;
}

export function getDealerTierFromProviderPlanId(planId: string | null | undefined): DealerTier {
  if (!planId) return "STARTER";
  const proPlanId = process.env.RIPPLE_DEALER_PRO_PLAN_ID ?? DEMO_PRO_PLAN_ID;
  if (proPlanId && planId === proPlanId) return "PRO";

  const starterPlanId =
    process.env.RIPPLE_DEALER_STARTER_PLAN_ID ?? DEMO_STARTER_PLAN_ID;
  if (starterPlanId && planId === starterPlanId) return "STARTER";

  return "STARTER";
}
