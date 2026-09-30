import type { Prisma, SampleCheckout } from "@prisma/client";
import { addClampedCalendarMonth } from "./ripple-calendar";
import { submitPaidListingForReview } from "./webhook-payments";
import type { NormalizedProviderWebhookEvent } from "./provider-types";

export async function fulfillSampleCheckout(
  tx: Prisma.TransactionClient, checkout: SampleCheckout,
  outcome: "SUCCEEDED" | "FAILED", attempt: number,
) {
  const now = new Date();
  const reference = `sim_${checkout.id}`;
  const attemptReference = `${reference}_${attempt}`;
  if (checkout.kind === "dealer_subscription") {
    if (!checkout.tier) throw new Error("Sample subscription tier is missing.");
    const values = {
      dealerId: checkout.targetId, paymentProvider: "DEV" as const, source: "PAYMENT" as const,
      providerSubscriptionId: reference, providerPlanId: `sim_${checkout.tier.toLowerCase()}`,
      status: outcome === "SUCCEEDED" ? "ACTIVE" as const : "INCOMPLETE" as const,
      currentPeriodEnd: outcome === "SUCCEEDED" ? addClampedCalendarMonth(now) : null,
      providerLifecycle: outcome === "SUCCEEDED" ? "ACTIVE" as const : "NONE" as const,
      lastProviderEventAt: now, lastProviderEventType: `sample.${outcome.toLowerCase()}`,
      lastProviderEventFingerprint: attemptReference,
    };
    const subscription = await tx.subscription.upsert({
      where: { providerSubscriptionId: reference }, create: values, update: values,
    });
    if (outcome === "SUCCEEDED") {
      await tx.subscriptionCharge.create({ data: {
        subscriptionId: subscription.id, paymentReference: attemptReference,
        amount: checkout.amountPence, currency: checkout.currency, eventTimestamp: now,
      } });
      await tx.dealerProfile.update({ where: { id: checkout.targetId }, data: { tier: checkout.tier } });
      await tx.user.updateMany({ where: { id: checkout.userId, role: "USER" }, data: { role: "DEALER" } });
    }
    return;
  }
  const payment = await tx.payment.updateMany({ where: {
    providerReference: reference, paymentProvider: "DEV", listingId: checkout.targetId,
    status: { in: ["PENDING", "FAILED"] },
  }, data: {
    status: outcome, providerPaymentId: attemptReference, lastProviderEventAt: now,
    lastProviderEventType: `sample.${outcome.toLowerCase()}`, lastProviderEventFingerprint: attemptReference,
  } });
  if (payment.count !== 1) throw new Error("Sample payment record is unavailable.");
  if (outcome !== "SUCCEEDED") return;
  if (checkout.kind === "featured_upgrade") {
    await tx.listing.update({ where: { id: checkout.targetId }, data: { featured: true } });
    return;
  }
  const event: NormalizedProviderWebhookEvent = {
    id: attemptReference, type: "payment.received", rawType: "sample.payment.received",
    providerPaymentId: attemptReference, providerReference: reference,
    providerSubscriptionId: null, providerPlanId: null, paymentStatus: "SUCCEEDED",
    subscriptionStatus: null, amount: checkout.amountPence, currency: checkout.currency,
    currentPeriodEnd: null, cancelAtPeriodEnd: null, eventTimestamp: now, clientId: null,
    customerEmail: null, linkCode: null, packageName: null, recurring: false, linkType: "one-off",
    fingerprint: attemptReference,
    metadata: { checkoutType: "listing_payment", listingId: checkout.targetId, dealerId: null, tier: null },
    payload: { simulated: true },
  };
  // Reuse actual moderation/validation rules. Sample payments do not send external emails.
  await submitPaidListingForReview(checkout.targetId, event, tx);
}
