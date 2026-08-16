import { DEALER_TIER_CAPS } from "../../lib/config/dealer-tiers";
import { ACTIVE_LISTING_STATUSES } from "./constants";

export function isActiveListingStatus(status: string) {
  return (ACTIVE_LISTING_STATUSES as readonly string[]).includes(status);
}

export function countActiveListings(
  listings: Array<{ dealerKey?: string; status: string }>,
  dealerKey: string,
) {
  return listings.filter(
    (listing) =>
      listing.dealerKey === dealerKey && isActiveListingStatus(listing.status),
  ).length;
}

export function assertDealerCaps(
  dealers: Array<{ key: string; tier: "STARTER" | "PRO" }>,
  listings: Array<{ dealerKey?: string; status: string }>,
) {
  for (const dealer of dealers) {
    const active = countActiveListings(listings, dealer.key);
    const cap = DEALER_TIER_CAPS[dealer.tier];
    if (active > cap) {
      throw new Error(
        `Dealer ${dealer.key} has ${active} active listings, cap is ${cap}.`,
      );
    }
  }
}
