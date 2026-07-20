import { db } from "@/lib/db";
import {
  MARKETPLACE_PRICING,
  MARKETPLACE_PRICE_SETTING_KEYS,
  type MarketplacePricing,
} from "./marketplace-pricing-definitions";

const MAX_PRICE_PENCE = 10_000_000;

export {
  getDealerPlanPricePence,
  isMarketplacePriceSettingKey,
  MARKETPLACE_PRICING,
  MARKETPLACE_PRICE_SETTING_KEYS,
  type MarketplacePriceName,
  type MarketplacePricing,
} from "./marketplace-pricing-definitions";

function validateStoredPrice(key: string, value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PRICE_PENCE
  ) {
    throw new Error(`The saved price for ${key} is invalid.`);
  }

  return value;
}

function getPriceOrBootstrapValue(
  settings: Map<string, unknown>,
  definition: { key: string; defaultPence: number },
): number {
  const persistedValue = settings.get(definition.key);
  if (persistedValue === undefined || persistedValue === null) {
    return definition.defaultPence;
  }

  return validateStoredPrice(definition.key, persistedValue);
}

/**
 * Reads the current prices directly from SiteSetting on every request.
 * Persisted rows win; code values are bootstrap fallbacks only until the
 * idempotent migration has populated those rows. Invalid persisted prices
 * deliberately throw so a checkout cannot silently charge a fallback amount.
 */
export async function getMarketplacePricing(): Promise<MarketplacePricing> {
  const rows = await db.siteSetting.findMany({
    where: { key: { in: MARKETPLACE_PRICE_SETTING_KEYS } },
    select: { key: true, value: true },
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));

  return {
    privateListingPence: getPriceOrBootstrapValue(
      settings,
      MARKETPLACE_PRICING.privateListing,
    ),
    featuredUpgradePence: getPriceOrBootstrapValue(
      settings,
      MARKETPLACE_PRICING.featuredUpgrade,
    ),
    dealerStarterMonthlyPence: getPriceOrBootstrapValue(
      settings,
      MARKETPLACE_PRICING.dealerStarterMonthly,
    ),
    dealerProMonthlyPence: getPriceOrBootstrapValue(
      settings,
      MARKETPLACE_PRICING.dealerProMonthly,
    ),
    optionalListingSupportPence: getPriceOrBootstrapValue(
      settings,
      MARKETPLACE_PRICING.optionalListingSupport,
    ),
  };
}
