export const ONBOARDING_PRO_ENDS_AT = new Date("2027-01-01T00:00:00.000Z");
export const ONBOARDING_PRO_END_LABEL = "23:59 on 31 December 2026 (Isle of Man time)";

export interface PromotionGrantSnapshot {
  id: string;
  source: "PAYMENT" | "ADMIN_GRANT";
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE";
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
  revokedAt: Date | null;
  currentPeriodEnd: Date | null;
  promotionCampaignId: string | null;
}

export type OnboardingGrantPlan =
  | { kind: "create"; startsAt: Date; endsAt: Date }
  | { kind: "preserve"; subscriptionId: string; startsAt: Date; endsAt: Date }
  | { kind: "reconcile"; subscriptionId: string; startsAt: Date; endsAt: Date }
  | {
      blocked:
        | "paid-subscription"
        | "promotion-ended"
        | "conflicting-admin-grant";
    };

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

function isValidRenewableGrant(subscription: PromotionGrantSnapshot, now: Date) {
  return (
    subscription.revokedAt === null &&
    subscription.grantStartsAt !== null &&
    subscription.grantStartsAt.getTime() <= now.getTime() &&
    subscription.grantEndsAt !== null &&
    subscription.grantEndsAt.getTime() > subscription.grantStartsAt.getTime()
  );
}

export function planPromotionGrant(input: {
  subscriptions: PromotionGrantSnapshot[];
  now: Date;
  campaignId: string | null;
}): OnboardingGrantPlan {
  if (input.now.getTime() >= ONBOARDING_PRO_ENDS_AT.getTime()) {
    return { blocked: "promotion-ended" };
  }
  if (hasActivePaidSubscription(input.subscriptions, input.now)) {
    return { blocked: "paid-subscription" };
  }

  const activeAdminGrants = input.subscriptions.filter(
    (subscription) =>
      subscription.source === "ADMIN_GRANT" &&
      subscription.status === "ACTIVE",
  );
  if (activeAdminGrants.length === 0) {
    return {
      kind: "create",
      startsAt: input.now,
      endsAt: ONBOARDING_PRO_ENDS_AT,
    };
  }
  if (activeAdminGrants.length !== 1) {
    return { blocked: "conflicting-admin-grant" };
  }

  const existingGrant = activeAdminGrants[0]!;
  if (
    !isValidRenewableGrant(existingGrant, input.now) ||
    !existingGrant.grantStartsAt ||
    !existingGrant.grantEndsAt
  ) {
    return { blocked: "conflicting-admin-grant" };
  }
  if (existingGrant.grantEndsAt.getTime() >= ONBOARDING_PRO_ENDS_AT.getTime()) {
    return {
      kind: "preserve",
      subscriptionId: existingGrant.id,
      startsAt: existingGrant.grantStartsAt,
      endsAt: existingGrant.grantEndsAt,
    };
  }
  if (
    existingGrant.promotionCampaignId !== null &&
    existingGrant.promotionCampaignId !== input.campaignId
  ) {
    return { blocked: "conflicting-admin-grant" };
  }
  return {
    kind: "reconcile",
    subscriptionId: existingGrant.id,
    startsAt: existingGrant.grantStartsAt,
    endsAt: ONBOARDING_PRO_ENDS_AT,
  };
}
