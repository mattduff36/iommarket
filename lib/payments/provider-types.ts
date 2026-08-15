import type { DealerTier, PaymentProvider } from "@prisma/client";
import type { RippleCheckoutType } from "@/lib/payments/ripple-config";

export type PaymentCheckoutType = RippleCheckoutType;

export type ProviderWebhookEventType =
  | "payment.received"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "payment.updated"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "subscription.paused"
  | "subscription.resumed"
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
  cancelAtPeriodEnd: boolean | null;
  eventTimestamp: Date | null;
  clientId: string | null;
  customerEmail: string | null;
  linkCode: string | null;
  packageName: string | null;
  recurring: boolean | null;
  linkType: string | null;
  fingerprint: string | null;
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
