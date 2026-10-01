import type { Prisma } from "@prisma/client";

export const EARLY_ACCESS_CAMPAIGN_KEY = "cars-buying-or-selling";
export const EARLY_ACCESS_CAR_INTERESTS = ["BUYING_CARS", "SELLING_CARS"] as const;

export function waitlistInterestsIncludeCars(interests: unknown): boolean {
  if (!Array.isArray(interests)) return false;
  return interests.some(
    (interest) => interest === "BUYING_CARS" || interest === "SELLING_CARS",
  );
}

export function earlyAccessAudienceWhere(): Prisma.WaitlistUserWhereInput {
  return {
    deletedAt: null,
    marketingConsentAt: { not: null },
    marketingWithdrawnAt: null,
    OR: EARLY_ACCESS_CAR_INTERESTS.map((interest) => ({
      interests: { array_contains: interest },
    })),
  };
}

export function isEligibleEarlyAccessWaitlistUser(user: {
  deletedAt: Date | null;
  marketingConsentAt: Date | null;
  marketingWithdrawnAt: Date | null;
  interests: unknown;
}): boolean {
  return (
    user.deletedAt === null &&
    user.marketingConsentAt !== null &&
    user.marketingWithdrawnAt === null &&
    waitlistInterestsIncludeCars(user.interests)
  );
}
