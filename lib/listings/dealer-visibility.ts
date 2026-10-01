import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import { DEFAULT_SAMPLE_VISIBILITY, type SampleVisibility } from "./sample-visibility";

/** Keep the advert's moderation state intact when dealer membership ends. */
export function publicListingSellerWhere(
  now = new Date(),
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingWhereInput {
  return { OR: [{ dealerId: null }, { dealer: { is: getPublicDealerWhere(now, sampleVisibility) } }] };
}

/** Request-scoped only: never cache entitlement across requests or revocations. */
export const hasPublicDealerListingAccess = cache(async (dealerId: string | null) => {
  if (!dealerId) return true;
  return Boolean(await db.dealerProfile.findFirst({
    where: { AND: [{ id: dealerId }, getPublicDealerWhere()] }, select: { id: true },
  }));
});
