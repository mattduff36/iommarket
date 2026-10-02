"use client";

import { useEffect, useState } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { redactAnalyticsUrl } from "@/lib/analytics/privacy";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  isAnalyticsAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";

export function ConsentedAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    function sync() {
      setAllowed(
        isAnalyticsAllowed(
          parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)),
        ),
      );
    }
    sync();
    window.addEventListener("itrader:cookie-consent-changed", sync);
    return () => window.removeEventListener("itrader:cookie-consent-changed", sync);
  }, []);

  if (!allowed) return null;
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => ({
        ...event,
        url: redactAnalyticsUrl(event.url),
      })}
    />
  );
}
