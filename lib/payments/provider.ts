import type { DealerTier, PaymentProvider } from "@prisma/client";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import {
  assertRippleAmountMatchesProduct,
  assertRippleHostedCheckoutAvailable,
  getConfiguredRippleProductUrl,
  getRippleProductByCheckoutType,
  getRippleTestSubscriptionProduct,
  isRipplePreviewRuntime,
  isRippleStagingLinkCode,
  getRippleWebhookSecret,
  isNonProductionRuntime,
  type RippleCheckoutType,
} from "@/lib/payments/ripple-config";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import {
  getRippleCustomerDetails,
  type RippleCheckoutPayer,
} from "@/lib/payments/ripple-customer-details";
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
    testPlan?: boolean;
    payer: RippleCheckoutPayer;
  }
): ProviderCheckoutResult {
  assertHostedCheckoutAvailable();
  const product = params.testPlan
    ? getRippleTestSubscriptionProduct()
    : getRippleProductByCheckoutType(checkoutType, params.tier);
  if (!product) throw new Error("The weekly test subscription is only available on preview");
  if (isRipplePreviewRuntime() && !isRippleStagingLinkCode(product.code)) {
    throw new Error("RIPPLE_STAGING_LINK_REQUIRED");
  }
  if (params.testPlan && (checkoutType !== "dealer_subscription" || params.tier !== "STARTER")) {
    throw new Error("The weekly test subscription uses Starter access");
  }
  assertRippleAmountMatchesProduct(product, params.amountInPence);
  const baseUrl = getConfiguredRippleProductUrl(product);
  const merchantReference = createRippleReference({
    purpose:
      checkoutType === "listing_payment"
        ? "listing_payment"
        : checkoutType === "listing_and_featured"
          ? "listing_and_featured"
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
  const customerDetails = getRippleCustomerDetails(params.payer);
  if (customerDetails) {
    url.searchParams.set("name", customerDetails.name);
    url.searchParams.set("email", customerDetails.email);
  }
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

/**
 * In-app refunds stay disabled until this is removed.
 *
 * adminRefundSubscriptionPayment writes the operation onto refundEventId
 * before any provider call. A later request that finds that claim and no
 * refundedAt skips the provider and still records the local refund. That
 * covers a crash after the claim commits, and an overlap that sets
 * refundedAt while the provider call is still running, after which a
 * provider failure can no longer clear the claim.
 */
export const IN_APP_REFUND_PREREQUISITES: readonly string[] = [
  "claim-without-refunded-at-skips-provider-and-records-locally",
];

export function getPaymentProviderCapabilities(): PaymentProviderCapabilities {
  return {
    supportsHostedCheckout: true,
    supportsEmbeddedCheckout: false,
    supportsInAppRefunds: IN_APP_REFUND_PREREQUISITES.length === 0,
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
  payer: RippleCheckoutPayer;
  idempotencyKey?: string;
}): Promise<ProviderCheckoutResult> {
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({
    tables: [{ table: "Listing", rowKey: params.listingId }],
    emails: [params.payer.email],
  });
  if ((params.checkoutType ?? "listing_payment") === "listing_support") {
    throw new Error("RIPPLE_LISTING_SUPPORT_URL");
  }
  return buildFixedCheckoutUrl("listing_payment", {
    targetId: params.listingId,
    amountInPence: params.amountInPence,
    payer: params.payer,
  });
}

export async function createListingAndFeaturedCheckout(params: {
  listingId: string;
  listingTitle: string;
  amountInPence: number;
  payer: RippleCheckoutPayer;
  successUrl: string;
  cancelUrl: string;
}): Promise<ProviderCheckoutResult> {
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({
    tables: [{ table: "Listing", rowKey: params.listingId }],
    emails: [params.payer.email],
  });
  return buildFixedCheckoutUrl("listing_and_featured", {
    targetId: params.listingId,
    amountInPence: params.amountInPence,
    payer: params.payer,
  });
}

export async function createDealerSubscriptionCheckout(params: {
  dealerId: string;
  tier: DealerTier;
  testPlan?: boolean;
  amountInPence: number;
  payer: RippleCheckoutPayer;
  successUrl: string;
  cancelUrl: string;
}): Promise<ProviderCheckoutResult> {
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({
    tables: [{ table: "DealerProfile", rowKey: params.dealerId }],
    emails: [params.payer.email],
  });
  return buildFixedCheckoutUrl("dealer_subscription", {
    targetId: params.dealerId,
    amountInPence: params.amountInPence,
    tier: params.tier,
    testPlan: params.testPlan,
    payer: params.payer,
  });
}

export async function createFeaturedUpgradeCheckout(params: {
  listingId: string;
  listingTitle: string;
  successUrl: string;
  cancelUrl: string;
  payer: RippleCheckoutPayer;
  amountInPence?: number;
}): Promise<ProviderCheckoutResult> {
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({
    tables: [{ table: "Listing", rowKey: params.listingId }],
    emails: [params.payer.email],
  });
  return buildFixedCheckoutUrl("featured_upgrade", {
    targetId: params.listingId,
    amountInPence: params.amountInPence,
    payer: params.payer,
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
