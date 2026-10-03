import type { MarketplaceEvent } from "./events";
import { sanitizeAnalyticsProperties } from "./events";

export type GoogleTag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: IArguments[];
    gtag?: GoogleTag;
    itraderGa4MeasurementId?: string;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

export function ensureGoogleTag(): GoogleTag {
  window.dataLayer = window.dataLayer ?? [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // gtag.js expects the canonical IArguments command queue.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  }
  return window.gtag;
}

export function googleDisableKey(measurementId: string): `ga-disable-${string}` {
  return `ga-disable-${measurementId}`;
}

export function sendMarketplaceAnalyticsEvent(
  measurementId: string,
  name: MarketplaceEvent,
  properties: Record<string, unknown> | undefined,
  page: { page_location: string; page_referrer?: string; page_title: string },
): void {
  const gtag = window.gtag;
  if (!gtag) return;
  const safeProperties = sanitizeAnalyticsProperties(properties);
  gtag("event", name, { ...safeProperties, ...page, send_to: measurementId });
}
