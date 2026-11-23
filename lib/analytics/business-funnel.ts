import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { londonDate, londonMidnight, shiftIsoDate } from "@/lib/analytics/london-date";
import {
  applySampleListingVisibility,
  applySampleUserVisibility,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";
import {
  applySampleFavouriteVisibility,
  applySampleListingViewVisibility,
  applySamplePaymentVisibility,
  applySampleSavedSearchVisibility,
  applySampleSubscriptionVisibility,
} from "@/lib/listings/sample-related-visibility";

export interface BusinessFunnel {
  views: number;
  signups: number;
  listingsSubmitted: number;
  checkoutStarted: number;
  checkoutCompleted: number;
  listingsLive: number;
  favourites: number;
  savedSearches: number;
  dealerSubscriptions: number;
}

export async function loadBusinessFunnel(input: {
  since: Date;
  until?: Date;
  sampleVisibility: SampleVisibility;
  liveWhere: Prisma.ListingWhereInput;
}): Promise<BusinessFunnel> {
  const created = { gte: input.since, ...(input.until ? { lt: input.until } : {}) };
  const visibleListings = applySampleListingVisibility({ createdAt: created }, input.sampleVisibility);
  const [
    views,
    signups,
    listingsSubmitted,
    checkoutStarted,
    checkoutCompleted,
    listingsLive,
    favourites,
    savedSearches,
    dealerSubscriptions,
  ] = await Promise.all([
    db.listingView.count({
      where: applySampleListingViewVisibility({ createdAt: created }, input.sampleVisibility),
    }),
    db.user.count({
      where: applySampleUserVisibility({ createdAt: created }, input.sampleVisibility),
    }),
    db.listing.count({
      where: { ...visibleListings, status: { not: "DRAFT" } },
    }),
    db.payment.count({
      where: applySamplePaymentVisibility({ createdAt: created }, input.sampleVisibility),
    }),
    db.payment.count({
      where: applySamplePaymentVisibility(
        { createdAt: created, status: "SUCCEEDED" },
        input.sampleVisibility,
      ),
    }),
    db.listing.count({
      where: { ...input.liveWhere, createdAt: created },
    }),
    db.favourite.count({
      where: applySampleFavouriteVisibility({ createdAt: created }, input.sampleVisibility),
    }),
    db.savedSearch.count({
      where: applySampleSavedSearchVisibility({ createdAt: created }, input.sampleVisibility),
    }),
    db.subscription.count({
      where: applySampleSubscriptionVisibility(
        { createdAt: created, status: { in: ["ACTIVE", "PAST_DUE"] } },
        input.sampleVisibility,
      ),
    }),
  ]);

  return {
    views,
    signups,
    listingsSubmitted,
    checkoutStarted,
    checkoutCompleted,
    listingsLive,
    favourites,
    savedSearches,
    dealerSubscriptions,
  };
}

export function analyticsRange(value: string | undefined, now = new Date()) {
  const key = value === "7d" || value === "90d" ? value : "30d";
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  const today = londonDate(now);
  const startDate = shiftIsoDate(today, -days);
  const since = londonMidnight(startDate);
  return {
    key,
    days,
    since,
    until: londonMidnight(today),
    startDate,
    endDate: shiftIsoDate(today, -1),
    previousSince: londonMidnight(shiftIsoDate(startDate, -days)),
  };
}
