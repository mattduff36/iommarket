import { SETTING_KEYS } from "./setting-keys";

export const MARKETPLACE_PRICING = {
  privateListing: {
    key: SETTING_KEYS.LISTING_FEE_PENCE,
    defaultPence: 499,
    label: "Private listing fee",
    billingPeriod: "one-time",
  },
  featuredUpgrade: {
    key: SETTING_KEYS.FEATURED_FEE_PENCE,
    defaultPence: 500,
    label: "Featured listing upgrade",
    billingPeriod: "one-time",
  },
  dealerStarterMonthly: {
    key: SETTING_KEYS.DEALER_STARTER_MONTHLY_PENCE,
    defaultPence: 2999,
    label: "Dealer Starter plan",
    billingPeriod: "monthly",
  },
  dealerProMonthly: {
    key: SETTING_KEYS.DEALER_PRO_MONTHLY_PENCE,
    defaultPence: 4999,
    label: "Dealer Pro plan",
    billingPeriod: "monthly",
  },
  optionalListingSupport: {
    key: SETTING_KEYS.OPTIONAL_LISTING_SUPPORT_PENCE,
    defaultPence: 500,
    label: "Optional platform support",
    billingPeriod: "one-time",
  },
} as const;

export type MarketplacePriceName = keyof typeof MARKETPLACE_PRICING;

export interface MarketplacePricing {
  privateListingPence: number;
  featuredUpgradePence: number;
  dealerStarterMonthlyPence: number;
  dealerProMonthlyPence: number;
  optionalListingSupportPence: number;
}

export const MARKETPLACE_PRICE_SETTING_KEYS = Object.values(MARKETPLACE_PRICING).map(
  (price) => price.key,
);

export function isMarketplacePriceSettingKey(
  key: string,
): key is (typeof MARKETPLACE_PRICE_SETTING_KEYS)[number] {
  return MARKETPLACE_PRICE_SETTING_KEYS.includes(
    key as (typeof MARKETPLACE_PRICE_SETTING_KEYS)[number],
  );
}

export function getDealerPlanPricePence(
  pricing: MarketplacePricing,
  tier: "STARTER" | "PRO",
): number {
  return tier === "PRO"
    ? pricing.dealerProMonthlyPence
    : pricing.dealerStarterMonthlyPence;
}
