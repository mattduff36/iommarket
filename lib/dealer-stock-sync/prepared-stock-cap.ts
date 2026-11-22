import type { DealerTier } from "@prisma/client";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

/** Owner-approved staging stock retained on 22 November pending dealer review. */
export function preparedStockCap(input: {
  tier: DealerTier;
  dealerId: string;
  registryKey: string;
}, env: NodeJS.ProcessEnv = process.env) {
  const standard = getDealerListingCap(input.tier);
  if (input.tier !== "PRO" || !isStagingOnlyFeatureEnabled(env)) return standard;
  if (input.registryKey === "van-mossel-jacksons" && input.dealerId === "cmwse345s002nfozjg6hk01vy") return 138;
  if (input.registryKey === "van-mossel-motor-mall" && input.dealerId === "cmwse38zx00affozj5zoaxuo9") return 112;
  return standard;
}

