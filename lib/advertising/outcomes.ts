import type { MarketplaceEvent } from "@/lib/analytics/events";

export const BROWSER_ADVERTISING_EVENTS = [
  "ViewContent",
  "Search",
  "Lead",
  "ContactClick",
  "CompleteRegistration",
  "ListingSubmitted",
  "InitiateCheckout",
] as const;

export type BrowserAdvertisingEvent = (typeof BROWSER_ADVERTISING_EVENTS)[number];
export type AdvertisingEventName = BrowserAdvertisingEvent | "Purchase";

export interface AdvertisingEvent {
  eventName: AdvertisingEventName;
  eventId: string;
  contentId?: string;
  category?: string;
  context?: string;
  value?: number;
  currency?: "GBP";
  transactionId?: string;
  campaignSource?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_CONTEXT = /^[a-z0-9_-]{1,40}$/;

export function marketplaceEventToAdvertising(
  name: MarketplaceEvent,
): BrowserAdvertisingEvent | null {
  switch (name) {
    case "listing_viewed":
      return "ViewContent";
    case "search_performed":
      return "Search";
    case "contact_seller_submitted":
      return "Lead";
    case "signup_completed":
      return "CompleteRegistration";
    case "listing_submitted":
      return "ListingSubmitted";
    case "checkout_started":
    case "dealer_conversion":
      return "InitiateCheckout";
    case "checkout_completed":
    case "favourite_added":
    case "saved_search_created":
      return null;
    default:
      return null;
  }
}

export function safeAdvertisingFields(properties: Record<string, unknown> | undefined) {
  const listingId = typeof properties?.listingId === "string" && SAFE_TOKEN.test(properties.listingId)
    ? properties.listingId
    : undefined;
  const category = typeof properties?.category === "string" && SAFE_TOKEN.test(properties.category)
    ? properties.category
    : undefined;
  const context = typeof properties?.context === "string" && SAFE_CONTEXT.test(properties.context)
    ? properties.context
    : undefined;
  return { contentId: listingId, category, context };
}

export function buildServicePurchaseEvent(input: {
  transactionId: string;
  amountPence: number;
  currency: string;
}): AdvertisingEvent | null {
  if (!SAFE_TOKEN.test(input.transactionId)) return null;
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) return null;
  if (input.currency.toLowerCase() !== "gbp") return null;
  return {
    eventName: "Purchase",
    eventId: `purchase:${input.transactionId}`,
    transactionId: input.transactionId,
    value: input.amountPence / 100,
    currency: "GBP",
  };
}

export function selectServicePurchaseSource(input: {
  payment: { id: string; amount: number; currency: string; status: string } | null;
  charge: { id: string; amount: number; currency: string } | null;
}): { transactionId: string; amountPence: number; currency: string } | null {
  if (input.payment && input.charge) return null;
  if (input.payment) {
    if (input.payment.status !== "SUCCEEDED") return null;
    return {
      transactionId: input.payment.id,
      amountPence: input.payment.amount,
      currency: input.payment.currency,
    };
  }
  if (!input.charge) return null;
  return {
    transactionId: input.charge.id,
    amountPence: input.charge.amount,
    currency: input.charge.currency,
  };
}
