"use client";

import { useEffect } from "react";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  isAnalyticsAllowed,
  isMarketingAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { dropQueuedAdvertisingEvents } from "@/lib/advertising/browser-queue";
import { ATTRIBUTION_COOKIE_NAME } from "@/lib/advertising/attribution-cookie";
import {
  applyCampaignTouch,
  parseStoredAttribution,
  readCampaignParams,
} from "@/lib/advertising/attribution";
import type { PublicAdvertisingConfig } from "@/lib/advertising/config";
import { ensureGoogleTag } from "@/lib/analytics/google-tag-client";

function readConsent() {
  return parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
}

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readCookie(name: string): string | null {
  const row = document.cookie.split("; ").find((item) => item.startsWith(`${name}=`));
  if (!row) return null;
  try {
    return decodeURIComponent(row.slice(name.length + 1));
  } catch {
    return null;
  }
}

function syncAttribution(allowed: boolean) {
  if (!allowed) {
    clearCookie(ATTRIBUTION_COOKIE_NAME);
    return;
  }
  const current = parseStoredAttribution(readCookie(ATTRIBUTION_COOKIE_NAME));
  const incoming = readCampaignParams(window.location.search);
  const next = applyCampaignTouch(current, incoming);
  if (!next) {
    clearCookie(ATTRIBUTION_COOKIE_NAME);
    return;
  }
  writeCookie(ATTRIBUTION_COOKIE_NAME, JSON.stringify(next), 90 * 24 * 60 * 60);
}

function removeScript(id: string) {
  document.getElementById(id)?.remove();
}

type MetaPixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
};

function installMetaPixel(pixelId: string) {
  const win = window as Window & { fbq?: MetaPixel };
  // Consent may have been denied on the first render, leaving a no-op fbq.
  // Replace it with the real queue when consent is subsequently granted.
  if (!win.fbq || !Array.isArray(win.fbq.queue)) {
    const fbq = function pixelQueue(...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as MetaPixel;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    win.fbq = fbq;
  }
  loadScript("itrader-meta-pixel", "https://connect.facebook.net/en_US/fbevents.js");
  win.fbq("init", pixelId);
  win.fbq("track", "PageView");
}

function loadScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function MarketingMeasurement({ config }: { config: PublicAdvertisingConfig }) {
  useEffect(() => {
    function sync() {
      const consent = readConsent();
      const marketing = isMarketingAllowed(consent);
      const analytics = isAnalyticsAllowed(consent);
      if (!marketing) dropQueuedAdvertisingEvents();
      syncAttribution(marketing);
      if (!config.enabled || !marketing) {
        const activeGtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
        activeGtag?.("consent", "update", {
          ad_storage: "denied",
          analytics_storage: analytics ? "granted" : "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        removeScript("itrader-meta-pixel");
        removeScript("itrader-ga4");
        clearCookie("_fbp");
        clearCookie("_fbc");
        const win = window as Window & { fbq?: (...args: unknown[]) => void };
        win.fbq = () => undefined;
        return;
      }
      if (config.metaPixelId) {
        installMetaPixel(config.metaPixelId);
      }
      if (config.ga4MeasurementId) {
        loadScript("itrader-ga4", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4MeasurementId)}`);
        const gtag = ensureGoogleTag();
        gtag("consent", "default", {
          ad_storage: "denied",
          analytics_storage: analytics ? "granted" : "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        gtag("consent", "update", {
          ad_storage: "granted",
          ad_user_data: "granted",
          ad_personalization: "denied",
          analytics_storage: analytics ? "granted" : "denied",
        });
        gtag("js", new Date());
        gtag("config", config.ga4MeasurementId, { send_page_view: true });
        if (config.googleAdsId) gtag("config", config.googleAdsId);
      }
    }
    sync();
    window.addEventListener("itrader:cookie-consent-changed", sync);
    return () => window.removeEventListener("itrader:cookie-consent-changed", sync);
  }, [config]);

  return null;
}
