"use client";

import { useEffect } from "react";
import { trackMarketplaceEvent } from "@/lib/analytics/track-client";
import type { MarketplaceEvent } from "@/lib/analytics/events";

export function ConsentedTrack({
  event,
  properties,
}: {
  event: MarketplaceEvent;
  properties?: Record<string, unknown>;
}) {
  useEffect(() => {
    trackMarketplaceEvent(event, properties);
  }, [event, properties]);
  return null;
}
