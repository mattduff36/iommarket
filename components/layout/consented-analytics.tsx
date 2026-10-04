"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  isAnalyticsAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { safeAnalyticsPageView } from "@/lib/analytics/privacy";
import { ensureGoogleTag, googleDisableKey } from "@/lib/analytics/google-tag-client";

const SCRIPT_ID = "itrader-google-analytics";

function removeGoogleScript() {
  document.getElementById(SCRIPT_ID)?.remove();
}

function loadGoogleScript(measurementId: string, onLoad: () => void) {
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.addEventListener("load", onLoad, { once: true });
  document.head.appendChild(script);
}

export function ConsentedAnalytics({
  enabled,
  measurementId,
}: {
  enabled: boolean;
  measurementId: string | null;
}) {
  const pathname = usePathname();
  const lastPageLocationRef = useRef<string | null>(null);

  useEffect(() => {
    const configuredMeasurementId = measurementId;
    if (!enabled || !configuredMeasurementId) return;
    const activeMeasurementId = configuredMeasurementId as string;
    function sync() {
      const tag = ensureGoogleTag();
      const pageView = safeAnalyticsPageView({
        protocol: window.location.protocol,
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        referrer: lastPageLocationRef.current ?? document.referrer,
      });
      const consent = parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
      const disabledKey = googleDisableKey(activeMeasurementId);

      if (!pageView || !isAnalyticsAllowed(consent)) {
        window[disabledKey] = true;
        tag("consent", "update", { analytics_storage: "denied" });
        window.itraderGa4MeasurementId = undefined;
        lastPageLocationRef.current = null;
        removeGoogleScript();
        return;
      }

      window[disabledKey] = false;
      if (!document.getElementById(SCRIPT_ID)) {
        tag("consent", "default", { analytics_storage: "denied" });
        tag("consent", "update", { analytics_storage: "granted" });
        tag("js", new Date());
        tag("config", activeMeasurementId, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          page_location: pageView.page_location,
          page_referrer: pageView.page_referrer,
          page_title: pageView.page_title,
        });
        loadGoogleScript(activeMeasurementId, () => {
          window.itraderGa4MeasurementId = activeMeasurementId;
          sync();
        });
        return;
      }

      if (window.itraderGa4MeasurementId !== activeMeasurementId) return;
      tag("consent", "update", { analytics_storage: "granted" });
      if (pageView.page_location !== lastPageLocationRef.current) {
        tag("event", "page_view", { ...pageView, send_to: activeMeasurementId });
        lastPageLocationRef.current = pageView.page_location;
      }
    }

    sync();
    window.addEventListener("itrader:cookie-consent-changed", sync);
    return () => window.removeEventListener("itrader:cookie-consent-changed", sync);
  }, [enabled, measurementId, pathname]);

  return null;
}
