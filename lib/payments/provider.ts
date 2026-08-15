import type { DealerTier, PaymentProvider } from "@prisma/client";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import {
  assertRippleAmountMatchesProduct,
  assertRippleHostedCheckoutAvailable,
  getConfiguredRippleProductUrl,
  getRippleProductByCheckoutType,
  getRippleWebhookSecret,
  isNonProductionRuntime,
  type RippleCheckoutType,
} from "@/lib/payments/ripple-config";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { verifyRippleWebhookSignature } from "@/lib/payments/ripple-signature";
import type {
  NormalizedProviderWebhookEvent,
  PaymentCheckoutType,
  PaymentProviderCapabilities,
  ProviderCheckoutResult,
  ProviderWebhookEventType,
  SubscriptionChargeSummary,
} from "@/lib/payments/provider-types";

export type {
  NormalizedProviderWebhookEvent,
  PaymentCheckoutType,
  PaymentProviderCapabilities,
  ProviderCheckoutResult,
  ProviderWebhookEventType,
  SubscriptionChargeSummary,
};

function buildUnsupportedActionError(action: string): Error {
  const portal = getPaymentProviderPortalUrl();
  const suffix = portal ? ` Use ${portal} to complete this action.` : "";
  return new Error(`In-app ${action} is not available for Ripple.${suffix}`);
}

function assertHostedCheckoutAvailable() {
  assertRippleHostedCheckoutAvailable();
}

function buildFixedCheckoutUrl(
  checkoutType: Exclude<RippleCheckoutType, "listing_support">,
  params: {
    targetId: string;
    amountInPence?: number;
    tier?: DealerTier;
  }
): ProviderCheckoutResult {
  assertHostedCheckoutAvailable();
  const product = getRippleProductByCheckoutType(checkoutType, params.tier);
  assertRippleAmountMatchesProduct(product, params.amountInPence);
  const baseUrl = getConfiguredRippleProductUrl(product);
  const merchantReference = createRippleReference({
    purpose:
      checkoutType === "listing_payment"
        ? "listing_payment"
        : checkoutType === "featured_upgrade"
          ? "featured_upgrade"
          : "dealer_subscription",
    targetId: params.targetId,
    linkCode: product.code,
    tier: params.tier,
  });
  const url = new URL(baseUrl);
  url.search = "";
  url.searchParams.set("reference", merchantReference);
  return {
    provider: "RIPPLE",
    merchantReference,
    url: url.toString(),
  };
}

export function getPaymentProviderCode(): PaymentProvider {
  return "RIPPLE";
}

export function getPaymentProviderName(): string {
  return "Ripple";
}

export function getPaymentProviderPortalUrl(): string | null {
  return process.env.RIPPLE_DASHBOARD_URL?.trim() || null;
}

export function getPaymentProviderCapabilities(): PaymentProviderCapabilities {
  return {
    supportsHostedCheckout: true,
    supportsEmbeddedCheckout: false,
    supportsInAppRefunds: false,
    supportsInAppSubscriptionCancellation: false,
    preferredCheckoutSurface: "HOSTED",
  };
}

export function isOptionalSupportCheckoutConfigured(): boolean {
  return false;
}

export function isDemoListingCheckoutConfigured(): boolean {
  if (!isNonProductionRuntime()) return false;
  return isRippleDemoCheckoutUrl(process.env.RIPPLE_LISTING_PAYMENT_URL);
}

export function isDemoDealerSubscriptionCheckoutConfigured(
  tier: DealerTier
): boolean {
  if (!isNonProductionRuntime()) return false;
  return isRippleDemoCheckoutUrl(
    process.env[tier === "PRO" ? "RIPPLE_DEALER_PRO_URL" : "RIPPLE_DEALER_STARTER_URL"]
  );
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
  if ((params.checkoutType ?? "listing_payment") === "listing_support") {
    throw new Error("RIPPLE_LISTING_SUPPORT_URL");
  }
  return buildFixedCheckoutUrl("listing_payment", {
    targetId: params.listingId,
    amountInPence: params.amountInPence,
  });
}

export async function createDealerSubscriptionCheckout(params: {
  dealerId: string;
  tier: DealerTier;
  amountInPence: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<ProviderCheckoutResult> {
  return buildFixedCheckoutUrl("dealer_subscription", {
    targetId: params.dealerId,
    amountInPence: params.amountInPence,
    tier: params.tier,
  });
}

export async function createFeaturedUpgradeCheckout(params: {
  listingId: string;
  listingTitle: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  amountInPence?: number;
}): Promise<ProviderCheckoutResult> {
  return buildFixedCheckoutUrl("featured_upgrade", {
    targetId: params.listingId,
    amountInPence: params.amountInPence,
  });
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
  verifyRippleWebhookSignature(body, headers, getRippleWebhookSecret());
}

export function normalizeProviderWebhookEvent(
  payload: unknown
): NormalizedProviderWebhookEvent {
  return parseRippleWebhookEnvelope(payload).event;
}
