import type { RuntimeEnv } from "@/lib/runtime-env";
import { resolveAdvertisingDestination } from "@/lib/advertising/config";
import type { AdvertisingEvent } from "@/lib/advertising/outcomes";

const sentEventIds = new Set<string>();
const inFlightEventIds = new Set<string>();
const MAX_SENT_IDS = 1000;

function rememberSent(eventId: string): boolean {
  if (sentEventIds.has(eventId)) return false;
  sentEventIds.add(eventId);
  if (sentEventIds.size > MAX_SENT_IDS) {
    const oldest = sentEventIds.values().next().value;
    if (oldest) sentEventIds.delete(oldest);
  }
  return true;
}

export function claimAdvertisingEvent(eventId: string): boolean {
  return rememberSent(eventId);
}

export function resetAdvertisingDeliveryForTests() {
  sentEventIds.clear();
  inFlightEventIds.clear();
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

async function deliverOnce(key: string, send: () => Promise<boolean>): Promise<"sent" | "duplicate" | "failed"> {
  if (sentEventIds.has(key) || inFlightEventIds.has(key)) return "duplicate";
  inFlightEventIds.add(key);
  try {
    if (!await send()) return "failed";
    rememberSent(key);
    return "sent";
  } finally {
    // A failed request remains retryable. A successful provider is recorded
    // separately, so retrying another provider does not resend this one.
    inFlightEventIds.delete(key);
  }
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let sent = false;
  try {
    const meta = destination.meta;
    if (meta) {
      const url = `https://graph.facebook.com/v21.0/${meta.datasetId}/events`;
      for (const event of events) {
        const result = await deliverOnce(`meta:${event.eventId}`, () => postWithRetry(
          url,
          { ...metaBody(event, options.sourceUrl ?? null), access_token: meta.accessToken },
          fetchImpl,
          sleep,
        ));
        if (result === "failed") return { delivered: false, reason: "provider_error", destination: destination.mode };
        sent ||= result === "sent";
      }
    }
    if (destination.ga4) {
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(destination.ga4.measurementId)}&api_secret=${encodeURIComponent(destination.ga4.apiSecret)}`;
      for (const event of events) {
        const result = await deliverOnce(`ga4:${event.eventId}`, () => postWithRetry(url, {
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
        }, fetchImpl, sleep));
        if (result === "failed") return { delivered: false, reason: "provider_error", destination: destination.mode };
        sent ||= result === "sent";
      }
    }
    return { delivered: sent, reason: sent ? "sent" : "duplicate", destination: destination.mode };
  } catch {
    return { delivered: false, reason: "provider_error", destination: destination.mode };
  }
}
