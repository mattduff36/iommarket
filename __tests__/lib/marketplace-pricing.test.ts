import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    siteSetting: {
      findMany: findManyMock,
    },
  },
}));

import {
  getMarketplacePricing,
  MARKETPLACE_PRICING,
} from "@/lib/config/marketplace-pricing";

describe("getMarketplacePricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses explicit bootstrap prices when settings have not been migrated", async () => {
    findManyMock.mockResolvedValue([]);

    await expect(getMarketplacePricing()).resolves.toEqual({
      privateListingPence: 499,
      featuredUpgradePence: 500,
      dealerStarterMonthlyPence: 2999,
      dealerProMonthlyPence: 4999,
      optionalListingSupportPence: 500,
    });
  });

  it("uses persisted admin prices over bootstrap values", async () => {
    findManyMock.mockResolvedValue([
      { key: MARKETPLACE_PRICING.privateListing.key, value: 749 },
      { key: MARKETPLACE_PRICING.featuredUpgrade.key, value: 875 },
      { key: MARKETPLACE_PRICING.dealerStarterMonthly.key, value: 3999 },
      { key: MARKETPLACE_PRICING.dealerProMonthly.key, value: 5999 },
      { key: MARKETPLACE_PRICING.optionalListingSupport.key, value: 600 },
    ]);

    await expect(getMarketplacePricing()).resolves.toMatchObject({
      privateListingPence: 749,
      featuredUpgradePence: 875,
      dealerStarterMonthlyPence: 3999,
      dealerProMonthlyPence: 5999,
      optionalListingSupportPence: 600,
    });
  });

  it("fails closed instead of silently charging an invalid saved price", async () => {
    findManyMock.mockResolvedValue([
      { key: MARKETPLACE_PRICING.privateListing.key, value: -1 },
    ]);

    await expect(getMarketplacePricing()).rejects.toThrow(
      "The saved price for listing_fee_pence is invalid.",
    );
  });
});
