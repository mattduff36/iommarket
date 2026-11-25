"use client";

import { ExternalLink } from "lucide-react";
import { trackMarketplaceEvent } from "@/lib/analytics/track-client";

export function DealerStockLink(props: { href: string; dealerName: string; dealerId: string; listingId: string }) {
  return (
    <a className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-neon-blue-400 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
      href={props.href} target="_blank" rel="noopener noreferrer"
      onClick={() => trackMarketplaceEvent("dealer_stock_link_clicked", { dealer_id: props.dealerId, listing_id: props.listingId })}>
      View on {props.dealerName}’s website
      <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
    </a>
  );
}
