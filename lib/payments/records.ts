import type { Prisma } from "@prisma/client";

export function getPaymentDisplayId(payment: {
  providerPaymentId?: string | null;
  providerReference?: string | null;
  stripePaymentId?: string | null;
}): string {
  return (
    payment.providerPaymentId ??
    payment.providerReference ??
    payment.stripePaymentId ??
    "-"
  );
}

export function getSubscriptionDisplayId(subscription: {
  providerSubscriptionId?: string | null;
  stripeSubscriptionId?: string | null;
}): string {
  return subscription.providerSubscriptionId ?? subscription.stripeSubscriptionId ?? "-";
}

export function getProviderLabel(value: string | null | undefined): string {
  if (value === "DEV") return "SAMPLE PAYMENT";
  return value ?? "STRIPE";
}

export function isPaidSubscriptionRecord(subscription: {
  source: "PAYMENT" | "ADMIN_GRANT";
}) {
  return subscription.source === "PAYMENT";
}

export function recognisedSubscriptionChargeWhere() {
  return { refundedAt: null } as const;
}

export function recognisedListingPaymentWhere(): Prisma.PaymentWhereInput {
  return { status: "SUCCEEDED", refundedAt: null };
}

export function isRecognisedListingRevenue(payment: {
  status: string;
  refundedAt: Date | null;
}) {
  return payment.status === "SUCCEEDED" && payment.refundedAt === null;
}

export function isRecognisedSubscriptionCharge(charge: { refundedAt: Date | null }) {
  return charge.refundedAt === null;
}
