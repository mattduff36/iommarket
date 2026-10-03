import {
  COOKIE_CONSENT_STORAGE_KEY,
  isMarketingAllowed,
  parseCookieConsent,
  type CookieConsentState,
} from "@/lib/consent/cookie-consent";
import type { BrowserAdvertisingEvent } from "@/lib/advertising/outcomes";

export const ADVERTISING_EVENT_STORAGE_KEY = "itrader-ad-event-ids";

interface QueuedAdvertisingEvent {
  eventName: BrowserAdvertisingEvent;
  eventId: string;
  contentId?: string;
  category?: string;
  context?: string;
  path?: string;
}

let queue: QueuedAdvertisingEvent[] = [];
let flushing = false;

export function dropQueuedAdvertisingEvents() {
  queue = [];
}

function rememberEvent(eventId: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(ADVERTISING_EVENT_STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    if (!Array.isArray(ids) || ids.includes(eventId)) return false;
    ids.push(eventId);
    window.sessionStorage.setItem(ADVERTISING_EVENT_STORAGE_KEY, JSON.stringify(ids.slice(-100)));
    return true;
  } catch {
    return true;
  }
}

export function enqueueAdvertisingEvent(
  event: QueuedAdvertisingEvent,
  consent: CookieConsentState | null,
) {
  if (!isMarketingAllowed(consent)) {
    dropQueuedAdvertisingEvents();
    return;
  }
  if (!rememberEvent(event.eventId)) return;
  queue = [...queue, event];
  void flushAdvertisingQueue(() => parseCookieConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)));
}

export async function flushAdvertisingQueue(readConsent: () => CookieConsentState | null) {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      if (!isMarketingAllowed(readConsent())) {
        dropQueuedAdvertisingEvents();
        return;
      }
      const [next, ...rest] = queue;
      queue = rest;
      if (!next) return;
      try {
        await fetch("/api/advertising/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
          keepalive: true,
        });
      } catch {
        return;
      }
    }
  } finally {
    flushing = false;
  }
}
