import type { DealerTier } from "@prisma/client";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";

/** Owner-approved 150-stock exceptions pending dealer review, 22 November 2026.
 * Registry bindings are unique and administrator-verified; account emails may change during onboarding.
 */
export function preparedStockCap(input: {
  tier: DealerTier;
  dealerId: string;
  registryKey: string;
}) {
  const standard = getDealerListingCap(input.tier);
  if (input.tier !== "PRO") return standard;
  if (input.registryKey === "van-mossel-jacksons" || input.registryKey === "van-mossel-motor-mall") return 150;
  return standard;
}

