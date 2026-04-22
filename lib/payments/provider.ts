import crypto from "crypto";
import { Webhook } from "standardwebhooks";
import type { DealerTier, PaymentProvider } from "@prisma/client";

export type PaymentCheckoutType =
  | "listing_payment"
  | "listing_support"
  | "featured_upgrade"
  | "dealer_subscription";

export type ProviderWebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "payment.updated"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "unknown";

export interface PaymentProviderCapabilities {
  supportsHostedCheckout: boolean;
  supportsEmbeddedCheckout: boolean;
  supportsInAppRefunds: boolean;
  supportsInAppSubscriptionCancellation: boolean;
  preferredCheckoutSurface: "HOSTED" | "EMBED";
}

export interface ProviderCheckoutResult {
  url: string;
  merchantReference: string;
  provider: PaymentProvider;
}

export interface NormalizedProviderWebhookEvent {
  id: string;
  type: ProviderWebhookEventType;
  rawType: string;
  providerPaymentId: string | null;
  providerReference: string | null;
  providerSubscriptionId: string | null;
  providerPlanId: string | null;
  paymentStatus: string | null;
  subscriptionStatus: string | null;
  amount: number | null;
  currency: string | null;
  currentPeriodEnd: Date | null;
  metadata: {
    checkoutType: PaymentCheckoutType | null;
    listingId: string | null;
    dealerId: string | null;
    tier: DealerTier | null;
  };
  payload: Record<string, unknown>;
}

export interface SubscriptionChargeSummary {
  invoiceId: string;
  paymentIntentId: string;
  amountPaid: number;
  currency: string;
}

const RIPPLE_DEMO_CLIENT_ID = "demo-gym";
const RIPPLE_DEMO_ORIGIN = "https://portal.startyourripple.co.uk";
const RIPPLE_DEMO_DASHBOARD_URL = `${RIPPLE_DEMO_ORIGIN}/portal/${RIPPLE_DEMO_CLIENT_ID}/card-portal`;
const RIPPLE_DEMO_SUBSCRIBE_URL = `${RIPPLE_DEMO_ORIGIN}/card/${RIPPLE_DEMO_CLIENT_ID}/subscribe`;
const RIPPLE_DEMO_PAY_ANY_URL = `${RIPPLE_DEMO_ORIGIN}/card/${RIPPLE_DEMO_CLIENT_ID}/pay-any`;
const RIPPLE_DEMO_EMBED_URL = `${RIPPLE_DEMO_ORIGIN}/card/${RIPPLE_DEMO_CLIENT_ID}/embed-widget`;

function getTrimmedEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function getPublicDemoUrl(key: string): string | null {
  switch (key) {
    case "RIPPLE_LISTING_PAYMENT_URL":
    case "RIPPLE_LISTING_SUPPORT_URL":
    case "RIPPLE_FEATURED_PAYMENT_URL":
      return RIPPLE_DEMO_PAY_ANY_URL;
    case "RIPPLE_DEALER_STARTER_URL":
    case "RIPPLE_DEALER_PRO_URL":
      return RIPPLE_DEMO_SUBSCRIBE_URL;
    case "RIPPLE_DASHBOARD_URL":
      return RIPPLE_DEMO_DASHBOARD_URL;
    case "RIPPLE_EMBED_SCRIPT_URL":
      return RIPPLE_DEMO_EMBED_URL;
    default:
      return null;
  }
}

function getUrlConfig(key: string): string | null {
  return getTrimmedEnv(key) ?? getPublicDemoUrl(key);
}

function requireEnv(key: string): string {
  const value = getUrlConfig(key) ?? getTrimmedEnv(key);
  if (!value) {
    throw new Error(`${key} is not set`);
  }
  return value;
}

function setQueryParam(url: URL, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  url.searchParams.set(key, String(value));
}

function buildMerchantReference(
  checkoutType: PaymentCheckoutType,
  targetId: string,
  idempotencyKey?: string
): string {
  if (idempotencyKey?.trim()) {
    return idempotencyKey.trim();
  }
  const nonce = crypto.randomUUID().split("-")[0];
  return `${checkoutType}:${targetId}:${nonce}`;
}

function buildHostedCheckoutUrl(
  baseUrl: string,
  params: {
    checkoutType: PaymentCheckoutType;
    merchantReference: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    listingId?: string;
    dealerId?: string;
    tier?: DealerTier;
    amountInPence?: number;
    listingTitle?: string;
  }
): string {
  const url = new URL(baseUrl);
  setQueryParam(url, "merchant_reference", params.merchantReference);
  setQueryParam(url, "reference", params.merchantReference);
  setQueryParam(url, "checkout_type", params.checkoutType);
  setQueryParam(url, "listing_id", params.listingId);
  setQueryParam(url, "dealer_id", params.dealerId);
  setQueryParam(url, "tier", params.tier);
  setQueryParam(url, "amount_pence", params.amountInPence);
  setQueryParam(url, "title", params.listingTitle);
  setQueryParam(url, "email", params.customerEmail);
  setQueryParam(url, "success_url", params.successUrl);
  setQueryParam(url, "cancel_url", params.cancelUrl);
  return url.toString();
}

function getHostedUrlForDealerTier(tier: DealerTier): string {
  return tier === "PRO"
    ? requireEnv("RIPPLE_DEALER_PRO_URL")
    : requireEnv("RIPPLE_DEALER_STARTER_URL");
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstObject(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const normalized = normalizeObject(value);
    if (normalized) return normalized;
  }
  return null;
}

function parsePence(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes(".")) {
      const decimal = Number.parseFloat(trimmed);
      return Number.isFinite(decimal) ? Math.round(decimal * 100) : null;
    }
    const integer = Number.parseInt(trimmed, 10);
    return Number.isFinite(integer) ? integer : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function mergeStringMaps(
  ...sources: Array<Record<string, unknown> | null>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const normalized = normalizeString(value);
      if (normalized) {
        result[key] = normalized;
      }
    }
  }
  return result;
}

function normalizePaymentStatus(status: string | null): string | null {
  if (!status) return null;
  return status.replace(/\s+/g, "_").toUpperCase();
}

function hasPaymentSuccessKeyword(rawType: string): boolean {
  return (
    rawType.includes("succeed") ||
    rawType.includes("paid") ||
    rawType.includes("complete")
  );
}

function hasPaymentFailureKeyword(rawType: string): boolean {
  return rawType.includes("fail") || rawType.includes("declin");
}

function inferEventType(input: {
  rawType: string;
  paymentStatus: string | null;
  subscriptionStatus: string | null;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
}): ProviderWebhookEventType {
  const raw = input.rawType.toLowerCase();

  if (raw.includes("refund")) return "payment.refunded";

  if (input.providerSubscriptionId || raw.includes("subscription")) {
    if (raw.includes("cancel") || raw.includes("delete")) return "subscription.cancelled";
    if (raw.includes("create") || raw.includes("start") || raw.includes("activate")) {
      return "subscription.created";
    }
    if (input.subscriptionStatus === "CANCELLED") return "subscription.cancelled";
    return "subscription.updated";
  }

  if (input.providerPaymentId || raw.includes("payment")) {
    if (hasPaymentSuccessKeyword(raw)) return "payment.succeeded";
    if (hasPaymentFailureKeyword(raw)) return "payment.failed";
    if (input.paymentStatus === "SUCCEEDED" || input.paymentStatus === "PAID" || input.paymentStatus === "COMPLETED") {
      return "payment.succeeded";
    }
    if (input.paymentStatus === "FAILED" || input.paymentStatus === "DECLINED") {
      return "payment.failed";
    }
    return "payment.updated";
  }

  return "unknown";
}

function safeCompareSignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function extractHeader(
  headers: Headers | Record<string, string | undefined>,
  key: string
): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }
  const match = Object.entries(headers).find(
    ([headerKey]) => headerKey.toLowerCase() === key.toLowerCase()
  );
  return normalizeString(match?.[1] ?? null);
}

function verifyStandardWebhooksSignature(
  body: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string
): boolean {
  const webhookId = extractHeader(headers, "webhook-id");
  const webhookTimestamp = extractHeader(headers, "webhook-timestamp");
  const webhookSignature = extractHeader(headers, "webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  const normalizedSecret = secret.replace(/^v1,whsec_/, "");
  const webhook = new Webhook(normalizedSecret);
  const headerObject = {
    "webhook-id": webhookId,
    "webhook-timestamp": webhookTimestamp,
    "webhook-signature": webhookSignature,
  };
  webhook.verify(body, headerObject);
  return true;
}

function verifyHmacSignature(
  body: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string
): boolean {
  const signature =
    extractHeader(headers, "ripple-signature") ??
    extractHeader(headers, "x-ripple-signature") ??
    extractHeader(headers, "x-signature");
  if (!signature) {
    return false;
  }

  const timestamp =
    extractHeader(headers, "ripple-timestamp") ??
    extractHeader(headers, "x-ripple-timestamp") ??
    extractHeader(headers, "x-timestamp");
  const normalizedSignature = signature.replace(/^sha256=/i, "").trim();
  const payloads = timestamp ? [body, `${timestamp}.${body}`] : [body];

  for (const payload of payloads) {
    const hex = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    if (safeCompareSignature(hex, normalizedSignature)) return true;

    const base64 = crypto.createHmac("sha256", secret).update(payload).digest("base64");
    if (safeCompareSignature(base64, normalizedSignature)) return true;
  }

  return false;
}

export function getPaymentProviderCode(): PaymentProvider {
  return "RIPPLE";
}

export function getPaymentProviderName(): string {
  return "Ripple";
}

export function getPaymentProviderPortalUrl(): string | null {
  return getUrlConfig("RIPPLE_DASHBOARD_URL");
}

export function getPaymentProviderCapabilities(): PaymentProviderCapabilities {
  const supportsEmbeddedCheckout = Boolean(getTrimmedEnv("RIPPLE_EMBED_SCRIPT_URL"));
  return {
    supportsHostedCheckout: true,
    supportsEmbeddedCheckout,
    supportsInAppRefunds: false,
    supportsInAppSubscriptionCancellation: false,
    preferredCheckoutSurface: supportsEmbeddedCheckout ? "EMBED" : "HOSTED",
  };
}

export function isOptionalSupportCheckoutConfigured(): boolean {
  return Boolean(getTrimmedEnv("RIPPLE_LISTING_SUPPORT_URL"));
}

export async function createListingCheckout(params: {
  listingId: string;
  listingTitle: string;
  amountInPence?: number;
  checkoutType?: "listing_payment" | "listing_support";
  supportAmountPence?: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  idempotencyKey?: string;
}): Promise<ProviderCheckoutResult> {
  const checkoutType = params.checkoutType ?? "listing_payment";
  const baseUrl =
    checkoutType === "listing_support"
      ? requireEnv("RIPPLE_LISTING_SUPPORT_URL")
      : requireEnv("RIPPLE_LISTING_PAYMENT_URL");
  const merchantReference = buildMerchantReference(
    checkoutType,
    params.listingId,
    params.idempotencyKey
  );
  return {
    provider: "RIPPLE",
    merchantReference,
    url: buildHostedCheckoutUrl(baseUrl, {
      checkoutType,
      merchantReference,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerEmail: params.customerEmail,
      listingId: params.listingId,
      amountInPence:
        checkoutType === "listing_support"
          ? params.amountInPence ?? params.supportAmountPence
          : params.amountInPence,
      listingTitle: params.listingTitle,
    }),
  };
}

export async function createDealerSubscriptionCheckout(params: {
  dealerId: string;
  tier: DealerTier;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<ProviderCheckoutResult> {
  const baseUrl = getHostedUrlForDealerTier(params.tier);
  const merchantReference = buildMerchantReference(
    "dealer_subscription",
    params.dealerId
  );
  return {
    provider: "RIPPLE",
    merchantReference,
    url: buildHostedCheckoutUrl(baseUrl, {
      checkoutType: "dealer_subscription",
      merchantReference,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerEmail: params.customerEmail,
      dealerId: params.dealerId,
      tier: params.tier,
      amountInPence: undefined,
      listingTitle: `${params.tier} dealer subscription`,
    }),
  };
}

export async function createFeaturedUpgradeCheckout(params: {
  listingId: string;
  listingTitle: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  amountInPence?: number;
}): Promise<ProviderCheckoutResult> {
  const baseUrl = requireEnv("RIPPLE_FEATURED_PAYMENT_URL");
  const merchantReference = buildMerchantReference(
    "featured_upgrade",
    params.listingId
  );
  return {
    provider: "RIPPLE",
    merchantReference,
    url: buildHostedCheckoutUrl(baseUrl, {
      checkoutType: "featured_upgrade",
      merchantReference,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerEmail: params.customerEmail,
      listingId: params.listingId,
      amountInPence: params.amountInPence,
      listingTitle: params.listingTitle,
    }),
  };
}

function buildUnsupportedActionError(action: string): Error {
  const portal = getPaymentProviderPortalUrl();
  const suffix = portal ? ` Use ${portal} to complete this action.` : "";
  return new Error(`In-app ${action} is not available for Ripple.${suffix}`);
}

export async function refundProviderPayment(_providerPaymentId: string) {
  throw buildUnsupportedActionError("refunds");
}

export async function getLatestPaidSubscriptionCharge(
  _providerSubscriptionId: string
): Promise<SubscriptionChargeSummary | null> {
  throw buildUnsupportedActionError("subscription refunds");
}

export async function cancelProviderSubscription(
  _providerSubscriptionId: string,
  _immediately: boolean
) {
  throw buildUnsupportedActionError("subscription cancellation");
}

export function verifyProviderWebhookSignature(
  body: string,
  headers: Headers | Record<string, string | undefined>
) {
  const secret = requireEnv("RIPPLE_WEBHOOK_SECRET");

  try {
    if (verifyStandardWebhooksSignature(body, headers, secret)) {
      return;
    }
  } catch {
    // Fall through to HMAC verification.
  }

  if (verifyHmacSignature(body, headers, secret)) {
    return;
  }

  throw new Error("Invalid webhook signature");
}

export function normalizeProviderWebhookEvent(
  payload: unknown
): NormalizedProviderWebhookEvent {
  const envelope = normalizeObject(payload);
  if (!envelope) {
    throw new Error("Webhook payload must be a JSON object");
  }

  const data =
    firstObject(envelope.data, envelope.eventData, envelope.payload, envelope.notification) ??
    envelope;

  const metadata = mergeStringMaps(
    normalizeObject(envelope.metadata),
    normalizeObject(data.metadata),
    normalizeObject(data.reference),
    normalizeObject(data.customFields),
    normalizeObject(data.custom_fields)
  );

  const checkoutType = firstString(
    metadata.checkoutType,
    metadata.checkout_type,
    metadata.type,
    data.checkoutType,
    data.checkout_type,
    data.type
  ) as PaymentCheckoutType | null;
  const listingId = firstString(
    metadata.listingId,
    metadata.listing_id,
    data.listingId,
    data.listing_id
  );
  const dealerId = firstString(
    metadata.dealerId,
    metadata.dealer_id,
    data.dealerId,
    data.dealer_id
  );
  const tierValue = firstString(
    metadata.tier,
    data.tier,
    data.package,
    data.plan
  );
  const tier = tierValue === "PRO" || tierValue === "STARTER" ? tierValue : null;

  const rawType =
    firstString(
      envelope.type,
      envelope.eventType,
      envelope.notification_type,
      envelope.notificationType,
      data.type,
      data.eventType
    ) ?? "unknown";

  const providerPaymentId = firstString(
    data.providerPaymentId,
    data.paymentId,
    data.payment_id,
    data.transactionId,
    data.transaction_id,
    data.chargeId,
    data.charge_id
  );
  const providerSubscriptionId = firstString(
    data.providerSubscriptionId,
    data.subscriptionId,
    data.subscription_id,
    data.subscriberId,
    data.subscriber_id
  );
  const providerPlanId = firstString(
    data.providerPlanId,
    data.planId,
    data.plan_id,
    data.packageId,
    data.package_id,
    data.priceId,
    data.price_id
  );
  const providerReference = firstString(
    metadata.providerReference,
    metadata.provider_reference,
    metadata.merchantReference,
    metadata.merchant_reference,
    data.providerReference,
    data.provider_reference,
    data.merchantReference,
    data.merchant_reference,
    data.reference
  );
  const paymentStatus = normalizePaymentStatus(
    firstString(data.paymentStatus, data.payment_status, data.state, data.status)
  );
  const subscriptionStatus = normalizePaymentStatus(
    firstString(
      data.subscriptionStatus,
      data.subscription_status,
      providerSubscriptionId ? data.status : null
    )
  );
  const amount =
    parsePence(data.amount_pence) ??
    parsePence(data.amountPence) ??
    parsePence(data.amount_minor) ??
    parsePence(data.amount);
  const currency =
    firstString(data.currency, data.currencyCode, data.currency_code) ?? "gbp";
  const currentPeriodEnd = parseDate(
    firstString(
      data.currentPeriodEnd,
      data.current_period_end,
      data.periodEnd,
      data.period_end,
      data.renewsAt,
      data.renews_at
    )
  );

  return {
    id: firstString(envelope.id, envelope.uuid, data.id, data.uuid, providerReference) ?? crypto.randomUUID(),
    rawType,
    type: inferEventType({
      rawType,
      paymentStatus,
      subscriptionStatus,
      providerPaymentId,
      providerSubscriptionId,
    }),
    providerPaymentId,
    providerReference,
    providerSubscriptionId,
    providerPlanId,
    paymentStatus,
    subscriptionStatus,
    amount,
    currency,
    currentPeriodEnd,
    metadata: {
      checkoutType,
      listingId,
      dealerId,
      tier,
    },
    payload: envelope,
  };
}
