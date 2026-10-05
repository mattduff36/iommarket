import { addRippleBillingPeriod } from "@/lib/payments/ripple-calendar";
import type { RippleProduct } from "@/lib/payments/ripple-config";

export type SubscriptionCoverageCharge = {
  id: string;
  eventTimestamp: Date;
  amount: number;
  currency: string;
  refundedAt: Date | null;
};

export type SubscriptionCoverageAmbiguity =
  | { code: "unknown-product" }
  | { code: "unmatched-charge"; chargeId: string }
  | { code: "missing-stored-period" }
  | {
      code: "stored-period-exceeds-charge-evidence";
      storedPeriodEnd: string;
      latestChargePeriodEnd: string | null;
    }
  | {
      code: "charge-evidence-exceeds-stored-period";
      storedPeriodEnd: string;
      chargePeriodEnd: string;
    };

export type RemainingSubscriptionCoverage = {
  status: "ACTIVE" | "CANCELLED";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  ambiguities: SubscriptionCoverageAmbiguity[];
};

function latestDate(dates: readonly Date[]): Date | null {
  return dates.reduce<Date | null>(
    (max, date) => (max === null || date.getTime() > max.getTime() ? date : max),
    null,
  );
}

function dealerProduct(
  product: RippleProduct | null,
): Extract<RippleProduct, { checkoutType: "dealer_subscription" }> | null {
  if (!product || product.checkoutType !== "dealer_subscription") return null;
  return product;
}

function provenChargePeriodEnd(
  charge: SubscriptionCoverageCharge,
  product: Extract<RippleProduct, { checkoutType: "dealer_subscription" }>,
): Date | null {
  if (charge.amount !== product.amountPence) return null;
  if (charge.currency.toLowerCase() !== "gbp") return null;
  return addRippleBillingPeriod(charge.eventTimestamp, product);
}

/**
 * Coverage ends are taken only from unrefunded charges whose amount and
 * currency match the subscription product, using the same billing-period
 * rule that granted the charge. A stored period is never extended, and a
 * refunded charge cannot keep a later date alive.
 */
export function remainingSubscriptionCoverage(input: {
  product: RippleProduct | null;
  charges: readonly SubscriptionCoverageCharge[];
  storedPeriodEnd: Date | null;
  now: Date;
  scheduledCancellation?: boolean;
}): RemainingSubscriptionCoverage {
  const product = dealerProduct(input.product);
  if (!product) {
    return {
      status: "CANCELLED",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      ambiguities: [{ code: "unknown-product" }],
    };
  }

  const ambiguities: SubscriptionCoverageAmbiguity[] = [];
  const provenEnds: Date[] = [];
  const unrefundedEnds: Date[] = [];
  for (const charge of input.charges) {
    const periodEnd = provenChargePeriodEnd(charge, product);
    if (!periodEnd) {
      ambiguities.push({ code: "unmatched-charge", chargeId: charge.id });
      continue;
    }
    provenEnds.push(periodEnd);
    if (!charge.refundedAt) unrefundedEnds.push(periodEnd);
  }

  const latestChargePeriodEnd = latestDate(provenEnds);
  if (
    input.storedPeriodEnd &&
    (!latestChargePeriodEnd ||
      input.storedPeriodEnd.getTime() > latestChargePeriodEnd.getTime())
  ) {
    ambiguities.push({
      code: "stored-period-exceeds-charge-evidence",
      storedPeriodEnd: input.storedPeriodEnd.toISOString(),
      latestChargePeriodEnd: latestChargePeriodEnd?.toISOString() ?? null,
    });
  }

  const unrefundedPeriodEnd = latestDate(unrefundedEnds);
  if (unrefundedPeriodEnd && !input.storedPeriodEnd) {
    ambiguities.push({ code: "missing-stored-period" });
    return {
      status: "CANCELLED",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      ambiguities,
    };
  }

  let periodEnd = unrefundedPeriodEnd;
  if (
    periodEnd &&
    input.storedPeriodEnd &&
    periodEnd.getTime() > input.storedPeriodEnd.getTime()
  ) {
    ambiguities.push({
      code: "charge-evidence-exceeds-stored-period",
      storedPeriodEnd: input.storedPeriodEnd.toISOString(),
      chargePeriodEnd: periodEnd.toISOString(),
    });
    periodEnd = input.storedPeriodEnd;
  }

  const entitled = periodEnd !== null && periodEnd.getTime() > input.now.getTime();
  return {
    status: entitled ? "ACTIVE" : "CANCELLED",
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: entitled ? input.scheduledCancellation === true : false,
    ambiguities,
  };
}
