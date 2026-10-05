import { db } from "@/lib/db";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { getRippleClientId } from "@/lib/payments/ripple-config";
import { getRippleProductByLinkCode } from "@/lib/payments/ripple-mapping";
import { normalizeRippleEmail, parseRippleReference } from "@/lib/payments/ripple-reference";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import type { HostedReturnResult } from "@/lib/payments/reconcile-hosted-return";
import { recordHostedReturnObservation } from "@/lib/payments/checkout-attempts";

// Subscription webhooks grant access independently. A return URL only reads the
// verified charge, and can never create a subscription or change entitlement.
export async function reconcileHostedSubscriptionReturn(
  context: Extract<HostedReturnContext, { kind: "dealer_subscription" }>,
  paymentJobRef: string,
): Promise<HostedReturnResult> {
  const now = Date.now();
  const product = getRippleProductByLinkCode(context.productCode);
  if (!/^\d{10,30}$/.test(paymentJobRef) || !product || product.checkoutType !== "dealer_subscription" ||
      !Number.isFinite(context.issuedAt) || context.issuedAt > now || now - context.issuedAt > 30 * 60_000) return { status: "review" };
  try {
    const claims = parseRippleReference(context.merchantReference, product.code);
    if (claims?.purpose !== "dealer_subscription" || claims.targetId !== context.dealerId ||
        !("tier" in product) || claims.tier !== product.tier) return { status: "review" };
  } catch { return { status: "review" }; }
  const observation = await recordHostedReturnObservation({
    merchantReference: context.merchantReference,
    userId: context.userId,
    providerPaymentId: paymentJobRef,
  });
  if (observation?.conflicts) return { status: "review" };

  return db.$transaction(async (tx) => {
    const dealer = await tx.dealerProfile.findUnique({ where: { id: context.dealerId }, select: { userId: true } });
    if (dealer?.userId !== context.userId) return { status: "review" as const };
    const receipts = await tx.paymentWebhookInbox.findMany({ where: { paymentReference: paymentJobRef } });
    if (!receipts.length) return { status: "waiting" as const };
    if (receipts.some((row) => !["payment.received", "payment.success", "subscription.created"].includes(row.eventType))) return { status: "review" as const };
    const paymentReceipts = receipts.filter((row) => ["payment.received", "payment.success"].includes(row.eventType));
    if (!paymentReceipts.length) return { status: "waiting" as const };
    const clientId = getRippleClientId();
    const earliest = context.issuedAt - 5000;
    for (const receipt of paymentReceipts) {
      if (["PENDING", "PROCESSING"].includes(receipt.status)) return { status: "waiting" as const };
      const raw = receipt.minimizedPayload;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "review" as const };
      if (receipt.status !== "PROCESSED" || receipt.clientId !== clientId || raw.client_id !== clientId ||
          receipt.linkCode !== product.code || raw.link_code !== product.code ||
          receipt.amountPence !== product.amountPence || raw.amount !== product.amountPence / 100 ||
          receipt.currency?.toLowerCase() !== "gbp" || typeof raw.currency !== "string" || raw.currency.toLowerCase() !== "gbp" ||
          receipt.recurring !== true || raw.recurring !== true || raw.payment_reference !== paymentJobRef ||
          raw.event !== receipt.eventType || !receipt.customerEmailNorm ||
          normalizeRippleEmail(receipt.customerEmailNorm) !== normalizeRippleEmail(context.email) ||
          receipt.eventTimestamp.getTime() < earliest || receipt.eventTimestamp.getTime() > now + 5000 ||
          receipt.createdAt.getTime() < earliest || receipt.createdAt.getTime() > now + 5000 ||
          typeof raw.timestamp !== "string" || new Date(raw.timestamp).getTime() !== receipt.eventTimestamp.getTime() ||
          (receipt.merchantReference && receipt.merchantReference !== context.merchantReference) ||
          (raw.merchant_reference && raw.merchant_reference !== context.merchantReference)) return { status: "review" as const };
    }
    const assignedPayment = await tx.payment.findUnique({ where: { providerPaymentId: paymentJobRef }, select: { id: true } });
    if (assignedPayment) return { status: "review" as const };
    const charge = await tx.subscriptionCharge.findUnique({ where: { paymentReference: paymentJobRef }, include: { subscription: true } });
    if (!charge) return { status: "waiting" as const };
    const subscription = charge.subscription;
    if (charge.amount !== product.amountPence || charge.currency.toLowerCase() !== "gbp" ||
        charge.eventTimestamp.getTime() < earliest || charge.eventTimestamp.getTime() > now + 5000 ||
        subscription.dealerId !== context.dealerId || subscription.paymentProvider !== "RIPPLE" ||
        subscription.source !== "PAYMENT" || subscription.providerPlanId !== product.code ||
        !subscription.customerEmailNorm || normalizeRippleEmail(subscription.customerEmailNorm) !== normalizeRippleEmail(context.email) ||
        !isPaidSubscriptionEntitled(subscription, new Date(now))) return { status: "review" as const };
    return { status: "confirmed" as const, checkoutType: "dealer_subscription" as const };
  }, { isolationLevel: "Serializable" });
}
