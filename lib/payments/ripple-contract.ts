import crypto from "crypto";
import type { DealerTier } from "@prisma/client";
import {
  getRippleClientId,
  type RippleCheckoutType,
} from "@/lib/payments/ripple-config";
import { resolveRippleProduct } from "@/lib/payments/ripple-mapping";
import {
  checkoutTypeFromReferencePurpose,
  normalizeRippleEmail,
  parseRippleReference,
} from "@/lib/payments/ripple-reference";
import type {
  NormalizedProviderWebhookEvent,
  ProviderWebhookEventType,
} from "@/lib/payments/provider-types";

export const RIPPLE_EVENT_TYPES = [
  "payment.received",
  "payment.success",
  "payment.failed",
  "subscription.created",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
] as const;

export type RippleEventName = (typeof RIPPLE_EVENT_TYPES)[number];

export interface RippleMinimizedPayload {
  event: string;
  client_id: string;
  timestamp: string;
  amount: number | null;
  currency: string | null;
  payment_reference: string | null;
  merchant_reference: string | null;
  link_code: string | null;
  link_type: string | null;
  recurring: boolean | null;
  package: string | null;
  description: string | null;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function parsePoundsToPence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rawPence = value * 100;
    const pence = Math.round(rawPence);
    return value >= 0 &&
      Number.isSafeInteger(pence) &&
      Math.abs(rawPence - pence) < 1e-8
      ? pence
      : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) return null;
    const [pounds, fraction = ""] = trimmed.split(".");
    const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(pence) ? pence : null;
  }
  return null;
}

function parseEventTimestamp(value: unknown): Date {
  const raw = asString(value);
  if (!raw) {
    throw new Error("Webhook timestamp is required");
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Webhook timestamp is invalid");
  }
  return date;
}

function mapRippleEventType(rawType: string): ProviderWebhookEventType {
  switch (rawType) {
    case "payment.received":
      return "payment.received";
    case "payment.success":
      return "payment.succeeded";
    case "payment.failed":
      return "payment.failed";
    case "subscription.created":
      return "subscription.created";
    case "subscription.cancelled":
      return "subscription.cancelled";
    case "subscription.paused":
      return "subscription.paused";
    case "subscription.resumed":
      return "subscription.resumed";
    default:
      return "unknown";
  }
}

export function parseRippleWebhookEnvelope(payload: unknown): {
  event: NormalizedProviderWebhookEvent;
  minimized: RippleMinimizedPayload;
  customerEmailNorm: string | null;
} {
  if (!isRecord(payload)) {
    throw new Error("Webhook payload must be a JSON object");
  }

  const rawType = asString(payload.event);
  if (!rawType || !RIPPLE_EVENT_TYPES.includes(rawType as RippleEventName)) {
    throw new Error("Unsupported Ripple webhook event");
  }

  const clientId = asString(payload.client_id);
  const expectedClientId = getRippleClientId();
  if (!clientId || clientId !== expectedClientId) {
    throw new Error("Ripple client_id mismatch");
  }

  const eventTimestamp = parseEventTimestamp(payload.timestamp);
  if (!isRecord(payload.data)) {
    throw new Error("Webhook data must be a JSON object");
  }
  const data = payload.data;
  const paymentReference = asString(data.payment_reference);
  const merchantReference = asString(data.merchant_reference);
  const linkCode = asString(data.link_code)?.toUpperCase() ?? null;
  const packageName = asString(data.package) ?? asString(data.description);
  const customerEmail = asString(data.customer_email);
  const amount = parsePoundsToPence(data.amount);
  const currency = asString(data.currency)?.toLowerCase();
  if (currency !== "gbp") {
    throw new Error("Ripple webhook currency must be GBP");
  }
  const product = resolveRippleProduct({ linkCode, packageName });

  let checkoutType: RippleCheckoutType | null = product?.checkoutType ?? null;
  let listingId: string | null = null;
  let dealerId: string | null = null;
  let tier: DealerTier | null =
    product && "tier" in product ? product.tier : null;

  if (merchantReference) {
    try {
      const claims = parseRippleReference(
        merchantReference,
        product?.code ?? linkCode
      );
      if (claims) {
        if (
          claims.purpose === "listing_payment" ||
          claims.purpose === "featured_upgrade"
        ) {
          listingId = claims.targetId;
        }
        if (claims.purpose === "dealer_subscription") {
          dealerId = claims.targetId;
          tier = claims.tier ?? tier;
        }
        checkoutType = checkoutTypeFromReferencePurpose(claims.purpose);
      }
    } catch {
      // Keep the raw merchant_reference. Processing must not fall back to email.
    }
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(
      [rawType, clientId, eventTimestamp.toISOString(), paymentReference ?? "", merchantReference ?? ""].join("|")
    )
    .digest("hex");

  const minimized: RippleMinimizedPayload = {
    event: rawType,
    client_id: clientId,
    timestamp: eventTimestamp.toISOString(),
    amount: typeof data.amount === "number" ? data.amount : amount === null ? null : amount / 100,
    currency,
    payment_reference: paymentReference,
    merchant_reference: merchantReference,
    link_code: linkCode,
    link_type: asString(data.link_type),
    recurring: asBoolean(data.recurring),
    package: packageName,
    description: asString(data.description),
    reason: asString(data.reason),
  };

  return {
    customerEmailNorm: customerEmail ? normalizeRippleEmail(customerEmail) : null,
    minimized,
    event: {
      id: fingerprint,
      type: mapRippleEventType(rawType),
      rawType,
      providerPaymentId: paymentReference,
      providerReference: merchantReference,
      providerSubscriptionId: null,
      providerPlanId: product?.code ?? linkCode ?? packageName,
      paymentStatus:
        rawType === "payment.failed"
          ? "FAILED"
          : rawType.startsWith("payment.")
            ? "SUCCEEDED"
            : null,
      subscriptionStatus: null,
      amount,
      currency,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      eventTimestamp,
      clientId,
      customerEmail,
      linkCode,
      packageName,
      recurring: asBoolean(data.recurring),
      linkType: asString(data.link_type),
      fingerprint,
      metadata: {
        checkoutType,
        listingId,
        dealerId,
        tier,
      },
      payload: { ...minimized } as Record<string, unknown>,
    },
  };
}

export function eventFromMinimizedPayload(input: {
  minimized: RippleMinimizedPayload;
  customerEmailNorm: string | null;
}): NormalizedProviderWebhookEvent {
  const parsed = parseRippleWebhookEnvelope({
    event: input.minimized.event,
    client_id: input.minimized.client_id,
    timestamp: input.minimized.timestamp,
    data: {
      amount: input.minimized.amount,
      currency: input.minimized.currency,
      payment_reference: input.minimized.payment_reference,
      merchant_reference: input.minimized.merchant_reference,
      link_code: input.minimized.link_code,
      link_type: input.minimized.link_type,
      recurring: input.minimized.recurring,
      package: input.minimized.package,
      description: input.minimized.description,
      reason: input.minimized.reason,
      customer_email: input.customerEmailNorm,
    },
  });
  return parsed.event;
}
