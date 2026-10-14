import type { Prisma, TradePriceType } from "@prisma/client";
import type { TradeSearchInput } from "@/lib/trade-exchange/validation";

export interface TradeSearchListing {
  make: string;
  model: string;
  year: number;
  mileage: number;
  transmission: string;
  fuel: string;
  conditionSummary: string;
  priceType: TradePriceType;
  pricePence: number | null;
  dealerId: string;
  publishedAt: Date | null;
}

export function tradeSearchWhere(filters: TradeSearchInput): Prisma.TradeListingWhereInput {
  const price: Prisma.IntNullableFilter | undefined =
    filters.minPrice != null || filters.maxPrice != null
      ? {
          ...(filters.minPrice != null ? { gte: filters.minPrice } : {}),
          ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {}),
        }
      : undefined;
  return {
    ...(filters.make ? { make: { contains: filters.make, mode: "insensitive" } } : {}),
    ...(filters.model ? { model: { contains: filters.model, mode: "insensitive" } } : {}),
    ...(filters.minYear != null || filters.maxYear != null
      ? { year: { ...(filters.minYear != null ? { gte: filters.minYear } : {}), ...(filters.maxYear != null ? { lte: filters.maxYear } : {}) } }
      : {}),
    ...(filters.minMileage != null || filters.maxMileage != null
      ? { mileage: { ...(filters.minMileage != null ? { gte: filters.minMileage } : {}), ...(filters.maxMileage != null ? { lte: filters.maxMileage } : {}) } }
      : {}),
    ...(filters.transmission ? { transmission: filters.transmission } : {}),
    ...(filters.fuel ? { fuel: filters.fuel } : {}),
    ...(filters.dealerId ? { dealerId: filters.dealerId } : {}),
    ...(filters.condition ? { conditionSummary: { contains: filters.condition, mode: "insensitive" } } : {}),
    ...(price ? { priceType: "FIXED", pricePence: price } : {}),
  };
}

export function listingMatchesSavedSearch(listing: TradeSearchListing, filters: Partial<TradeSearchInput>): boolean {
  const contains = (value: string, query: string | undefined) =>
    !query || value.toLowerCase().includes(query.toLowerCase());
  if (!contains(listing.make, filters.make) || !contains(listing.model, filters.model)) return false;
  if (!contains(listing.conditionSummary, filters.condition)) return false;
  if (filters.transmission && listing.transmission !== filters.transmission) return false;
  if (filters.fuel && listing.fuel !== filters.fuel) return false;
  if (filters.dealerId && listing.dealerId !== filters.dealerId) return false;
  if (filters.minYear != null && listing.year < filters.minYear) return false;
  if (filters.maxYear != null && listing.year > filters.maxYear) return false;
  if (filters.minMileage != null && listing.mileage < filters.minMileage) return false;
  if (filters.maxMileage != null && listing.mileage > filters.maxMileage) return false;
  if (filters.minPrice != null || filters.maxPrice != null) {
    if (listing.priceType !== "FIXED" || listing.pricePence == null) return false;
    if (filters.minPrice != null && listing.pricePence < filters.minPrice) return false;
    if (filters.maxPrice != null && listing.pricePence > filters.maxPrice) return false;
  }
  return true;
}
