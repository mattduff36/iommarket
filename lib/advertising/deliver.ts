import type { RuntimeEnv } from "@/lib/runtime-env";
import { resolveAdvertisingDestination } from "@/lib/advertising/config";
import type { AdvertisingEvent } from "@/lib/advertising/outcomes";

const sentEventIds = new Set<string>();
const MAX_SENT_IDS = 1000;

export function claimAdvertisingEvent(eventId: string): boolean {
  if (sentEventIds.has(eventId)) return false;
  sentEventIds.add(eventId);
  if (sentEventIds.size > MAX_SENT_IDS) {
    const oldest = sentEventIds.values().next().value;
    if (oldest) sentEventIds.delete(oldest);
  }
  return true;
}

export function resetAdvertisingDeliveryForTests() {
  sentEventIds.clear();
}

export interface DeliveryResult {
  delivered: boolean;
  reason: string;
  destination: "off" | "test" | "live";
}

async function postOnce(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<"ok" | "retry" | "fail"> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) return "ok";
    if (response.status === 429 || response.status >= 500) return "retry";
    return "fail";
  } catch {
    return "retry";
  }
}

async function postWithRetry(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const first = await postOnce(url, body, fetchImpl);
  if (first === "ok") return true;
  if (first === "fail") return false;
  await sleep(200);
  return (await postOnce(url, body, fetchImpl)) === "ok";
}

function metaBody(event: AdvertisingEvent, sourceUrl: string | null) {
  return {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
        custom_data: {
          ...(event.contentId ? { content_ids: [event.contentId], content_type: "vehicle" } : {}),
          ...(event.category ? { content_category: event.category } : {}),
          ...(event.campaignSource ? { campaign_source: event.campaignSource } : {}),
          ...(event.currency && event.value !== undefined
            ? { currency: event.currency, value: event.value }
            : {}),
        },
      },
    ],
  };
}

export async function deliverAdvertisingEvents(
  events: AdvertisingEvent[],
  options: {
    env?: RuntimeEnv;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    sourceUrl?: string | null;
  } = {},
): Promise<DeliveryResult> {
  const destination = resolveAdvertisingDestination(options.env);
  if (destination.mode === "off") {
    return { delivered: false, reason: destination.reason, destination: "off" };
  }
  const pending = events.filter((event) => claimAdvertisingEvent(event.eventId));
  if (pending.length === 0) {
    return { delivered: false, reason: "duplicate", destination: destination.mode };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    if (destination.meta) {
      const url = `https://graph.facebook.com/v21.0/${destination.meta.datasetId}/events`;
      for (const event of pending) {
        const ok = await postWithRetry(
          url,
          { ...metaBody(event, options.sourceUrl ?? null), access_token: destination.meta.accessToken },
          fetchImpl,
          sleep,
        );
        if (!ok) return { delivered: false, reason: "provider_error", destination: destination.mode };
      }
    }
    if (destination.ga4) {
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(destination.ga4.measurementId)}&api_secret=${encodeURIComponent(destination.ga4.apiSecret)}`;
      for (const event of pending) {
        const ok = await postWithRetry(url, {
          client_id: event.transactionId ?? event.eventId,
          events: [
            {
              name: event.eventName === "Purchase" ? "purchase" : event.eventName,
              params: {
                event_id: event.eventId,
                ...(event.transactionId ? { transaction_id: event.transactionId } : {}),
                ...(event.contentId ? { item_id: event.contentId } : {}),
                ...(event.currency && event.value !== undefined
                  ? { currency: event.currency, value: event.value }
                  : {}),
              },
            },
          ],
        }, fetchImpl, sleep);
        if (!ok) return { delivered: false, reason: "provider_error", destination: destination.mode };
      }
    }
    return { delivered: true, reason: "sent", destination: destination.mode };
  } catch {
    return { delivered: false, reason: "provider_error", destination: destination.mode };
  }
}
