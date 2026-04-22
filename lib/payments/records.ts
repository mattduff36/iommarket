export function getPaymentDisplayId(payment: {
  providerPaymentId?: string | null;
  providerReference?: string | null;
  stripePaymentId?: string | null;
}): string {
  return (
    payment.providerPaymentId ??
    payment.providerReference ??
    payment.stripePaymentId ??
    "—"
  );
}

export function getSubscriptionDisplayId(subscription: {
  providerSubscriptionId?: string | null;
  stripeSubscriptionId?: string | null;
}): string {
  return subscription.providerSubscriptionId ?? subscription.stripeSubscriptionId ?? "—";
}

export function getProviderLabel(value: string | null | undefined): string {
  return value ?? "STRIPE";
}
