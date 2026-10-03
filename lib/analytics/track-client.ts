import { enqueueAdvertisingEvent } from "@/lib/advertising/browser-queue";
import {
  marketplaceEventToAdvertising,
  safeAdvertisingFields,
} from "@/lib/advertising/outcomes";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  isAnalyticsAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import type { MarketplaceEvent } from "./events";
import { sendMarketplaceAnalyticsEvent } from "./google-tag-client";
import { safeAnalyticsPageView } from "./privacy";

function forwardAdvertisingEvent(
  name: MarketplaceEvent,
  properties: Record<string, unknown> | undefined,
  consent: ReturnType<typeof parseCookieConsent>,
) {
  const eventName = marketplaceEventToAdvertising(name);
  if (!eventName) return;
  const fields = safeAdvertisingFields(properties);
  const path = /^\/[A-Za-z0-9/_-]{0,100}$/.test(window.location.pathname)
    ? window.location.pathname
    : undefined;
  enqueueAdvertisingEvent(
    {
      eventName,
      // Each actual action is a new event. Stable IDs for Search/Lead silently
      // discarded subsequent valid actions for the rest of the browser session.
      eventId: crypto.randomUUID(),
      ...fields,
      path,
    },
    consent,
  );
}

export function trackMarketplaceEvent(
  name: MarketplaceEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const consent = parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
  forwardAdvertisingEvent(name, properties, consent);
  if (!isAnalyticsAllowed(consent)) return;
  const measurementId = window.itraderGa4MeasurementId;
  if (!measurementId || window[`ga-disable-${measurementId}`]) return;
  const page = safeAnalyticsPageView({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    referrer: document.referrer,
  });
  if (!page) return;
  sendMarketplaceAnalyticsEvent(measurementId, name, properties, page);
}
