import { PAID_ENTITLEMENT_DAYS } from "./constants";

export function addUtcDays(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000);
}

export function buildPaidEntitlementDates(now: Date) {
  return {
    currentPeriodEnd: addUtcDays(now, PAID_ENTITLEMENT_DAYS),
  };
}

export function buildGrantEntitlementDates(now: Date, days = PAID_ENTITLEMENT_DAYS) {
  return {
    grantStartsAt: now,
    grantEndsAt: addUtcDays(now, days),
    currentPeriodEnd: addUtcDays(now, days),
  };
}

export function isCurrentPaidEntitlement(
  subscription: {
    source: string;
    status: string;
    currentPeriodEnd: Date | null;
  },
  now: Date,
) {
  return (
    subscription.source === "PAYMENT" &&
    subscription.status === "ACTIVE" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > now
  );
}

export function isCurrentAdminGrant(
  subscription: {
    source: string;
    status: string;
    revokedAt?: Date | null;
    grantStartsAt?: Date | null;
    grantEndsAt?: Date | null;
  },
  now: Date,
) {
  return (
    subscription.source === "ADMIN_GRANT" &&
    subscription.status === "ACTIVE" &&
    !subscription.revokedAt &&
    subscription.grantStartsAt !== null &&
    subscription.grantStartsAt !== undefined &&
    subscription.grantStartsAt <= now &&
    subscription.grantEndsAt !== null &&
    subscription.grantEndsAt !== undefined &&
    subscription.grantEndsAt > now
  );
}

export function isPublicDealerEntitled(
  subscriptions: Array<{
    source: string;
    status: string;
    currentPeriodEnd: Date | null;
    revokedAt?: Date | null;
    grantStartsAt?: Date | null;
    grantEndsAt?: Date | null;
  }>,
  now: Date,
) {
  return subscriptions.some(
    (subscription) =>
      isCurrentPaidEntitlement(subscription, now) ||
      isCurrentAdminGrant(subscription, now),
  );
}
