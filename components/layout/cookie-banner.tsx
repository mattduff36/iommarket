"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  COOKIE_CONSENT_COOKIE_NAME,
  COOKIE_CONSENT_STORAGE_KEY,
  buildCookieConsent,
  currentCookieConsentVersion,
  parseCookieConsent,
  serializeCookieConsent,
  type CookieConsentState,
} from "@/lib/consent/cookie-consent";

function persistConsent(state: CookieConsentState) {
  const serialized = serializeCookieConsent(state);
  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, serialized);
  document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(serialized)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new Event("itrader:cookie-consent-changed"));
}

function readConsent() {
  return parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    function sync() {
      const stored = readConsent();
      const stale = !stored || stored.version !== currentCookieConsentVersion();
      setVisible(stale);
      setAnalytics(stored?.analytics ?? false);
    }
    function openPreferences() {
      setManaging(true);
      setVisible(true);
    }
    sync();
    window.addEventListener("itrader:open-cookie-preferences", openPreferences);
    window.addEventListener("itrader:cookie-consent-changed", sync);
    return () => {
      window.removeEventListener("itrader:open-cookie-preferences", openPreferences);
      window.removeEventListener("itrader:cookie-consent-changed", sync);
    };
  }, []);

  function decide(nextAnalytics: boolean) {
    persistConsent(buildCookieConsent(nextAnalytics));
    setVisible(false);
    setManaging(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed left-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface px-4 py-3 shadow-high sm:left-1/2 sm:right-auto sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <p className="text-xs leading-relaxed text-text-secondary sm:text-sm">
        We use essential cookies to keep the marketplace secure and functional.
        Analytics cookies are optional and off until you choose. Read our{" "}
        <Link href="/cookies" className="text-text-trust hover:underline">
          cookie policy
        </Link>
        .
      </p>
      {managing ? (
        <div className="mt-3 space-y-3">
          <Checkbox
            checked={analytics}
            onCheckedChange={(value) => setAnalytics(value === true)}
            label="Analytics cookies help us understand how the site is used. They are not required."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" size="sm" onClick={() => decide(analytics)}>
              Save preferences
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => decide(false)}>
              Reject non-essential
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="sm" onClick={() => decide(true)}>
            Accept all
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => decide(false)}>
            Reject non-essential
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setManaging(true)}>
            Manage preferences
          </Button>
        </div>
      )}
    </div>
  );
}

export function CookiePreferencesButton({
  className,
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        window.dispatchEvent(new Event("itrader:open-cookie-preferences"));
      }}
    >
      Cookie preferences
    </button>
  );
}
