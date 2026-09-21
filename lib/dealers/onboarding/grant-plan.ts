export interface PromotionGrantSnapshot {
  source: "PAYMENT" | "ADMIN_GRANT";
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE";
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
  revokedAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface PlannedPromotionGrant {
  startsAt: Date;
  endsAt: Date;
  preservedLongerGrant: boolean;
}

export function hasActivePaidSubscription(
  subscriptions: PromotionGrantSnapshot[],
  now: Date,
) {
  return subscriptions.some(
    (subscription) =>
      subscription.source === "PAYMENT" &&
      subscription.status === "ACTIVE" &&
      subscription.currentPeriodEnd !== null &&
      subscription.currentPeriodEnd.getTime() > now.getTime(),
  );
}

export function planPromotionGrant(input: {
  subscriptions: PromotionGrantSnapshot[];
  campaignStartsAt: Date;
  campaignEndsAt: Date;
  now: Date;
}): PlannedPromotionGrant | { blocked: "paid-subscription" } {
  if (hasActivePaidSubscription(input.subscriptions, input.now)) {
    return { blocked: "paid-subscription" };
  }

  const activeGrant = input.subscriptions.find(
    (subscription) =>
      subscription.source === "ADMIN_GRANT" &&
      subscription.status === "ACTIVE" &&
      subscription.revokedAt === null &&
      subscription.grantStartsAt !== null &&
      subscription.grantStartsAt.getTime() <= input.now.getTime() &&
      subscription.grantEndsAt !== null &&
      subscription.grantEndsAt.getTime() > input.now.getTime(),
  );
  if (!activeGrant?.grantEndsAt) {
    return {
      startsAt: input.campaignStartsAt,
      endsAt: input.campaignEndsAt,
      preservedLongerGrant: false,
    };
  }

  const preservedLongerGrant =
    activeGrant.grantEndsAt.getTime() > input.campaignEndsAt.getTime();
  return {
    startsAt: activeGrant.grantStartsAt ?? input.campaignStartsAt,
    endsAt: preservedLongerGrant ? activeGrant.grantEndsAt : input.campaignEndsAt,
    preservedLongerGrant,
  };
}
