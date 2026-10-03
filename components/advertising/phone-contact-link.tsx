"use client";

import type { ReactNode } from "react";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { enqueueAdvertisingEvent } from "@/lib/advertising/browser-queue";

export function PhoneContactLink({
  href,
  dealerKey,
  className,
  children,
}: {
  href: string;
  dealerKey: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        const safeKey = dealerKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
        enqueueAdvertisingEvent(
          {
            eventName: "ContactClick",
            eventId: `ContactClick:${safeKey || "dealer"}`,
            path: window.location.pathname,
          },
          parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)),
        );
      }}
    >
      {children}
    </a>
  );
}
