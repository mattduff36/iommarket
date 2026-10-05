import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { captureBusinessEvent } from "@/lib/monitoring";
import {
  remainingSubscriptionCoverage,
  type SubscriptionCoverageAmbiguity,
} from "@/lib/payments/subscription-coverage";
import {
  getDealerTierFromRippleProduct,
  resolveRippleProduct,
} from "@/lib/payments/ripple-mapping";
import type { DealerTier } from "@prisma/client";

type PaymentDb = Prisma.TransactionClient | typeof db;

export type SubscriptionRefundClassification =
  | { kind: "full" }
  | { kind: "partial"; refundedPence: number; chargePence: number }
  | { kind: "mismatch"; reason: "missing-amount" | "currency" | "exceeds-charge" | "zero" };

/**
 * Ripple refund webhooks reuse `data.amount` as decimal pounds and require GBP.
 * The contract has no separate refunded-amount field, so a smaller positive
 * amount is a partial refund and must not retire the whole charge.
 */
export function classifySubscriptionRefund(input: {
  chargeAmount: number;
  chargeCurrency: string;
  refundAmount: number | null;
  refundCurrency: string | null;
}): SubscriptionRefundClassification {
  const chargeCurrency = input.chargeCurrency.toLowerCase();
  if (!chargeCurrency || !input.refundCurrency || input.refundCurrency.toLowerCase() !== chargeCurrency) {
    return { kind: "mismatch", reason: "currency" };
  }
  if (
    input.refundAmount === null ||
    !Number.isSafeInteger(input.chargeAmount) ||
    !Number.isSafeInteger(input.refundAmount)
  ) {
    return { kind: "mismatch", reason: "missing-amount" };
  }
  if (input.refundAmount === 0) return { kind: "mismatch", reason: "zero" };
  if (input.refundAmount > input.chargeAmount) return { kind: "mismatch", reason: "exceeds-charge" };
  if (input.refundAmount < input.chargeAmount) {
    return { kind: "partial", refundedPence: input.refundAmount, chargePence: input.chargeAmount };
  }
  return { kind: "full" };
}

export async function recomputeDealerTier(
  dealerId: string,
  now = new Date(),
  client: PaymentDb = db,
) {
  const subscriptions = await client.subscription.findMany({
    where: { dealerId, source: "PAYMENT" },
  });
  const entitledTiers = subscriptions
    .filter((subscription) => isPaidSubscriptionEntitled(subscription, now))
    .map((subscription) =>
      getDealerTierFromRippleProduct(
        resolveRippleProduct({
          linkCode: subscription.providerPlanId,
          packageName: subscription.providerPlanId,
        }),
      ),
    )
    .filter((tier): tier is DealerTier => Boolean(tier));

  if (entitledTiers.includes("PRO")) {
    await client.dealerProfile.update({
      where: { id: dealerId },
      data: { tier: "PRO" },
    });
    return;
  }
  if (entitledTiers.includes("STARTER")) {
    await client.dealerProfile.update({
      where: { id: dealerId },
      data: { tier: "STARTER" },
    });
  }
}

export async function applyRecordedChargeRefund(
  client: PaymentDb,
  input: {
    chargeId: string;
    subscriptionId: string;
    refundedAt: Date;
    refundEventId: string;
    now: Date;
    recordCharge?: boolean;
  },
) {
  if (input.recordCharge !== false) {
    await client.subscriptionCharge.updateMany({
      where: { id: input.chargeId, refundedAt: null },
      data: {
        refundedAt: input.refundedAt,
        refundEventId: input.refundEventId,
      },
    });
  }

  const subscription = await client.subscription.findUnique({
    where: { id: input.subscriptionId },
    include: {
      charges: {
        select: {
          id: true,
          eventTimestamp: true,
          amount: true,
          currency: true,
          refundedAt: true,
        },
      },
    },
  });
  if (!subscription || subscription.source !== "PAYMENT") {
    await captureBusinessEvent({
      source: "WEBHOOK",
      severity: "MEDIUM",
      title: "Subscription refund coverage is ambiguous",
      message: "A refunded subscription charge has no payable subscription to recompute.",
      action: "applyRecordedChargeRefund",
      route: "/api/webhooks/payments",
      requestPath: "/api/webhooks/payments",
      tags: { ambiguity: "missing-payment-subscription" },
    });
    return { subscriptionId: input.subscriptionId, applied: false as const };
  }

  const charges = subscription.charges.map((row) =>
    row.id === input.chargeId ? { ...row, refundedAt: row.refundedAt ?? input.refundedAt } : row,
  );
  const coverage = remainingSubscriptionCoverage({
    product: resolveRippleProduct({
      linkCode: subscription.providerPlanId,
      packageName: subscription.providerPlanId,
    }),
    charges,
    storedPeriodEnd: subscription.currentPeriodEnd,
    now: input.now,
    scheduledCancellation: subscription.cancelAtPeriodEnd,
  });
  if (coverage.ambiguities.length > 0) {
    await reportCoverageAmbiguity(coverage.ambiguities);
  }
  const updated = await client.subscription.update({
    where: { id: subscription.id },
    data: {
      status: coverage.status,
      currentPeriodEnd: coverage.currentPeriodEnd,
      cancelAtPeriodEnd: coverage.cancelAtPeriodEnd,
    },
  });
  await recomputeDealerTier(subscription.dealerId, input.now, client);
  return { subscription: updated, applied: true as const, coverage };
}

async function reportCoverageAmbiguity(ambiguities: SubscriptionCoverageAmbiguity[]) {
  await captureBusinessEvent({
    source: "WEBHOOK",
    severity: "MEDIUM",
    title: "Subscription refund coverage is ambiguous",
    message: "Refunded subscription coverage could not be dated from stored charge evidence.",
    action: "applyRecordedChargeRefund",
    route: "/api/webhooks/payments",
    requestPath: "/api/webhooks/payments",
    tags: { ambiguities: ambiguities.map((item) => item.code) },
  });
}
