import type { PrismaClient } from "@prisma/client";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import type { HostedCheckoutLink, PaymentReturnContext } from "@/lib/payments/checkout-handoff";
import { normalizeRippleEmail } from "@/lib/payments/ripple-reference";

type LinkStore = Pick<PrismaClient, "payment" | "subscriptionCharge">;

function contextFor(context: HostedReturnContext): PaymentReturnContext {
  if (context.kind === "featured_upgrade") return "featured";
  if (context.kind === "dealer_subscription") return "subscription";
  return "listing";
}

export async function readLinkedHostedCheckout(
  store: LinkStore,
  context: HostedReturnContext,
): Promise<HostedCheckoutLink> {
  const label = contextFor(context);
  if (context.kind === "dealer_subscription") {
    const charge = await store.subscriptionCharge.findFirst({
      where: {
        createdAt: { gte: new Date(context.issuedAt - 5_000) },
        subscription: {
          dealerId: context.dealerId,
          paymentProvider: "RIPPLE",
          source: "PAYMENT",
          providerPlanId: context.productCode,
          customerEmailNorm: normalizeRippleEmail(context.email),
        },
      },
      include: { subscription: true },
      orderBy: { createdAt: "desc" },
    });
    if (!charge) return { status: "waiting", context: label };
    if (!isPaidSubscriptionEntitled(charge.subscription)) return { status: "review", context: label };
    return { status: "confirmed", context: label };
  }

  const payment = await store.payment.findUnique({
    where: { id: context.paymentId },
    select: {
      status: true,
      refundedAt: true,
      listingId: true,
      listing: { select: { userId: true } },
    },
  });
  if (
    !payment ||
    payment.refundedAt ||
    payment.listingId !== context.listingId ||
    payment.listing.userId !== context.userId
  ) {
    return { status: "review", context: label, listingId: context.listingId };
  }
  if (payment.status === "SUCCEEDED") {
    return { status: "confirmed", context: label, listingId: payment.listingId };
  }
  if (payment.status === "FAILED") {
    return { status: "failed", context: label, listingId: payment.listingId };
  }
  return { status: "waiting", context: label, listingId: context.listingId };
}
