export const ONBOARDING_PRO_ENDS_AT = new Date("2027-01-01T00:00:00.000Z");
export const ONBOARDING_PRO_END_LABEL = "23:59 on 31 December 2026 (Isle of Man time)";

export interface PromotionGrantSnapshot {
  source: "PAYMENT" | "ADMIN_GRANT";
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE";
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
  revokedAt: Date | null;
  currentPeriodEnd: Date | null;
}

export type OnboardingGrantPlan =
  | { kind: "create"; startsAt: Date; endsAt: Date }
  | { kind: "preserve"; endsAt: Date }
  | { blocked: "paid-subscription" | "promotion-ended" };

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

function coversPromotionEnd(subscription: PromotionGrantSnapshot, now: Date) {
  return (
    subscription.source === "ADMIN_GRANT" &&
    subscription.status === "ACTIVE" &&
    subscription.revokedAt === null &&
    subscription.grantStartsAt !== null &&
    subscription.grantStartsAt.getTime() <= now.getTime() &&
    subscription.grantEndsAt !== null &&
    subscription.grantEndsAt.getTime() >= ONBOARDING_PRO_ENDS_AT.getTime()
  );
}

export function planPromotionGrant(input: {
  subscriptions: PromotionGrantSnapshot[];
  now: Date;
}): OnboardingGrantPlan {
  if (input.now.getTime() >= ONBOARDING_PRO_ENDS_AT.getTime()) {
    return { blocked: "promotion-ended" };
  }
  if (hasActivePaidSubscription(input.subscriptions, input.now)) {
    return { blocked: "paid-subscription" };
  }

  const coveringGrant = input.subscriptions.find((subscription) =>
    coversPromotionEnd(subscription, input.now),
  );
  if (coveringGrant?.grantEndsAt) {
    return { kind: "preserve", endsAt: coveringGrant.grantEndsAt };
  }

  return {
    kind: "create",
    startsAt: input.now,
    endsAt: ONBOARDING_PRO_ENDS_AT,
  };
}
