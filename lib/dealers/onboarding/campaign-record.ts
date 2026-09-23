import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LAUNCH_PROMOTION_KEY, LAUNCH_PROMOTION_TIMEZONE } from "@/lib/dealers/onboarding/campaign-window";
import { ONBOARDING_PRO_ENDS_AT } from "@/lib/dealers/onboarding/grant-plan";

interface OnboardingCampaignRecord {
  id: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  tier: "STARTER" | "PRO";
  lockedAt: Date | null;
  createdByAdminId: string;
}

function campaignIsCurrent(campaign: OnboardingCampaignRecord) {
  return (
    campaign.timezone === LAUNCH_PROMOTION_TIMEZONE &&
    campaign.tier === "PRO" &&
    campaign.endsAt.getTime() === ONBOARDING_PRO_ENDS_AT.getTime()
  );
}

async function normalizeOnboardingCampaign(campaign: OnboardingCampaignRecord) {
  if (campaignIsCurrent(campaign)) return campaign;
  const updated = await db.dealerPromotionCampaign.updateMany({
    where: { id: campaign.id },
    data: {
      timezone: LAUNCH_PROMOTION_TIMEZONE,
      tier: "PRO",
      endsAt: ONBOARDING_PRO_ENDS_AT,
    },
  });
  if (updated.count !== 1) {
    throw new Error("The onboarding campaign changed. Refresh and try again.");
  }
  return {
    ...campaign,
    timezone: LAUNCH_PROMOTION_TIMEZONE,
    tier: "PRO" as const,
    endsAt: ONBOARDING_PRO_ENDS_AT,
  };
}

export async function ensureOnboardingCampaign(adminId: string) {
  const existing = await db.dealerPromotionCampaign.findUnique({
    where: { key: LAUNCH_PROMOTION_KEY },
  });
  if (!existing) {
    try {
      return await db.dealerPromotionCampaign.create({
        data: {
          key: LAUNCH_PROMOTION_KEY,
          timezone: LAUNCH_PROMOTION_TIMEZONE,
          startsAt: new Date(),
          endsAt: ONBOARDING_PRO_ENDS_AT,
          tier: "PRO",
          createdByAdminId: adminId,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const raced = await db.dealerPromotionCampaign.findUnique({
        where: { key: LAUNCH_PROMOTION_KEY },
      });
      if (!raced) throw error;
      return normalizeOnboardingCampaign(raced);
    }
  }
  return normalizeOnboardingCampaign(existing);
}
