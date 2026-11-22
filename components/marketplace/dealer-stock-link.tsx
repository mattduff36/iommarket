"use client";

import { trackMarketplaceEvent } from "@/lib/analytics/track-client";

export function DealerStockLink(props: { href: string; dealerName: string; dealerId: string; listingId: string }) {
  return (
    <a className="text-sm text-text-secondary underline hover:text-text-primary"
      href={props.href} target="_blank" rel="noopener noreferrer"
      onClick={() => trackMarketplaceEvent("dealer_stock_link_clicked", { dealer_id: props.dealerId, listing_id: props.listingId })}>
      View on {props.dealerName}’s website
    </a>
  );
}
