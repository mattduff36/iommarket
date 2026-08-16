import { SEED_PAYMENT_NAMESPACE } from "./constants";

export function seedPaymentId(listingKey: string) {
  return `${SEED_PAYMENT_NAMESPACE}pay:${listingKey}`;
}

export function seedPaymentReference(listingKey: string) {
  return `${SEED_PAYMENT_NAMESPACE}ref:${listingKey}`;
}

export function seedPaymentIdempotencyKey(listingKey: string) {
  return `${SEED_PAYMENT_NAMESPACE}idem:${listingKey}`;
}

export function seedSubscriptionId(dealerSlug: string) {
  return `${SEED_PAYMENT_NAMESPACE}sub:${dealerSlug}`;
}

export function seedPlanId(tier: "STARTER" | "PRO") {
  return tier === "PRO" ? "seed_demo_pro" : "seed_demo_starter";
}

export function isSyntheticPaymentReference(value: string) {
  return value.startsWith(SEED_PAYMENT_NAMESPACE);
}

export function assertSyntheticFinancialRow(input: {
  paymentProvider: string;
  providerReference?: string | null;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  providerPlanId?: string | null;
  customerEmailNorm?: string | null;
}) {
  if (input.paymentProvider !== "DEV") {
    throw new Error("Synthetic financial rows must use paymentProvider DEV.");
  }
  if (input.customerEmailNorm != null) {
    throw new Error("Synthetic financial rows must keep customerEmailNorm null.");
  }
  const refs = [
    input.providerReference,
    input.providerPaymentId,
    input.providerSubscriptionId,
  ].filter((value): value is string => Boolean(value));
  if (refs.some((value) => !isSyntheticPaymentReference(value))) {
    throw new Error("Synthetic financial rows must use seed:demo: references.");
  }
  if (
    input.providerPlanId &&
    input.providerPlanId !== "seed_demo_starter" &&
    input.providerPlanId !== "seed_demo_pro"
  ) {
    throw new Error("Synthetic subscriptions must use seed_demo plan IDs.");
  }
}
