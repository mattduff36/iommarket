import { getDealerTierFromProviderPlanId } from "@/lib/payments/ripple-mapping";

export interface TradeSubscriptionSnapshot {
  source: "PAYMENT" | "ADMIN_GRANT";
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE";
  currentPeriodEnd: Date | null;
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
  revokedAt: Date | null;
  providerPlanId: string | null;
}

function paidPro(subscription: TradeSubscriptionSnapshot, now: Date): boolean {
  return (
    subscription.source === "PAYMENT" &&
    subscription.status === "ACTIVE" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > now &&
    getDealerTierFromProviderPlanId(subscription.providerPlanId) === "PRO"
  );
}

function paidEntitled(subscription: TradeSubscriptionSnapshot, now: Date): boolean {
  return (
    subscription.source === "PAYMENT" &&
    subscription.status === "ACTIVE" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > now
  );
}

function activeGrant(subscription: TradeSubscriptionSnapshot, now: Date): boolean {
  return (
    subscription.source === "ADMIN_GRANT" &&
    subscription.status === "ACTIVE" &&
    subscription.revokedAt === null &&
    subscription.grantStartsAt !== null &&
    subscription.grantEndsAt !== null &&
    subscription.grantStartsAt <= now &&
    subscription.grantEndsAt > now
  );
}

/**
 * Pro access follows the paid plan or an active admin grant.
 * A stored dealer tier never grants access on its own.
 * An entitled non-Pro payment blocks a grant, matching dealer entitlement.
 */
export function hasTradeProEntitlement(input: {
  tier: "STARTER" | "PRO";
  subscriptions: TradeSubscriptionSnapshot[];
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const paid = input.subscriptions.filter((subscription) => paidEntitled(subscription, now));
  if (paid.some((subscription) => paidPro(subscription, now))) return true;
  if (paid.length > 0) return false;
  return input.tier === "PRO" && input.subscriptions.some((subscription) => activeGrant(subscription, now));
}
