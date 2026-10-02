export const MARKETPLACE_EVENTS = [
  "search_performed",
  "listing_viewed",
  "contact_seller_submitted",
  "signup_completed",
  "listing_submitted",
  "checkout_started",
  "checkout_completed",
  "favourite_added",
  "saved_search_created",
  "dealer_conversion",
] as const;

export type MarketplaceEvent = (typeof MARKETPLACE_EVENTS)[number];

const BLOCKED_PROPERTY = /(email|name|phone|token|secret|password|user|message|query)/i;

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!properties) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (BLOCKED_PROPERTY.test(key)) continue;
    if (typeof value === "string") {
      if (value.includes("@") || value.length > 80) continue;
      safe[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}
