import { track } from "@vercel/analytics";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  isAnalyticsAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { sanitizeAnalyticsProperties, type MarketplaceEvent } from "./events";

export function trackMarketplaceEvent(
  name: MarketplaceEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const consent = parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
  if (!isAnalyticsAllowed(consent)) return;
  track(name, sanitizeAnalyticsProperties(properties));
}
