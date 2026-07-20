import { db } from "@/lib/db";
import type {
  DealerTier,
  Prisma,
  SubscriptionSource,
  SubscriptionStatus,
} from "@prisma/client";

interface DealerSubscriptionRecord {
  id: string;
  source: SubscriptionSource;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  grantStartsAt: Date | null;
  grantEndsAt: Date | null;
  revokedAt: Date | null;
}

interface DealerAccessSubject {
  role: "USER" | "DEALER" | "ADMIN";
  dealerProfile: { id: string; tier: DealerTier } | null;
}

interface GrantAccessInput {
  dealerId: string;
  adminId: string;
  durationDays: number;
  now?: Date;
}

const DEALER_ACCESS_ROLES = new Set(["DEALER", "ADMIN"]);
const MILLISECONDS_PER_DAY = 86_400_000;

export type AdminGrantState = "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED";

export interface DealerEntitlement {
  subscriptionId: string;
  source: SubscriptionSource;
  tier: DealerTier;
  endsAt: Date | null;
}

export function hasDealerAccountAccess(
  user: DealerAccessSubject
): user is DealerAccessSubject & {
  dealerProfile: NonNullable<DealerAccessSubject["dealerProfile"]>;
} {
  return DEALER_ACCESS_ROLES.has(user.role) && user.dealerProfile !== null;
}

export function getAdminGrantState(
  grant: Pick<
    DealerSubscriptionRecord,
    "status" | "grantStartsAt" | "grantEndsAt" | "revokedAt"
  > | null,
  now = new Date()
): AdminGrantState {
  if (!grant) return "NONE";
  if (grant.revokedAt || grant.status === "CANCELLED") return "REVOKED";
  if (
    grant.status !== "ACTIVE" ||
    !grant.grantStartsAt ||
    !grant.grantEndsAt ||
    grant.grantStartsAt > now ||
    grant.grantEndsAt <= now
  ) {
    return "EXPIRED";
  }

  return "ACTIVE";
}

export function isActiveDealerSubscription(
  subscription: DealerSubscriptionRecord,
  now = new Date()
) {
  if (subscription.source === "PAYMENT") {
    return subscription.status === "ACTIVE";
  }

  return getAdminGrantState(subscription, now) === "ACTIVE";
}

export async function getDealerEntitlement(
  dealerId: string,
  tier: DealerTier,
  now = new Date()
): Promise<DealerEntitlement | null> {
  const [paidSubscription, adminGrant] = await Promise.all([
    db.subscription.findFirst({
      where: {
        dealerId,
        source: "PAYMENT",
        status: "ACTIVE",
      },
      select: { id: true, source: true, currentPeriodEnd: true },
    }),
    db.subscription.findFirst({
      where: {
        dealerId,
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        revokedAt: null,
        grantStartsAt: { lte: now },
        grantEndsAt: { gt: now },
      },
      select: { id: true, source: true, grantEndsAt: true },
    }),
  ]);

  if (paidSubscription) {
    return {
      subscriptionId: paidSubscription.id,
      source: paidSubscription.source,
      tier,
      endsAt: paidSubscription.currentPeriodEnd,
    };
  }
  if (!adminGrant) return null;

  return {
    subscriptionId: adminGrant.id,
    source: adminGrant.source,
    tier,
    endsAt: adminGrant.grantEndsAt,
  };
}

export async function getCurrentDealerEntitlement(
  user: DealerAccessSubject,
  now = new Date()
) {
  if (!hasDealerAccountAccess(user)) return null;

  return getDealerEntitlement(user.dealerProfile.id, user.dealerProfile.tier, now);
}

export async function grantAdminDealerAccess(
  tx: Prisma.TransactionClient,
  input: GrantAccessInput
) {
  const now = input.now ?? new Date();
  const paidSubscription = await tx.subscription.findFirst({
    where: {
      dealerId: input.dealerId,
      source: "PAYMENT",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (paidSubscription) {
    return { kind: "paid-access-preserved" as const, subscription: paidSubscription };
  }

  await tx.dealerProfile.update({
    where: { id: input.dealerId },
    data: { tier: "STARTER" },
  });

  const existingGrant = await tx.subscription.findFirst({
    where: {
      dealerId: input.dealerId,
      source: "ADMIN_GRANT",
      status: "ACTIVE",
    },
    select: {
      id: true,
      grantEndsAt: true,
      grantStartsAt: true,
    },
  });
  const isExtending = Boolean(
    existingGrant?.grantEndsAt && existingGrant.grantEndsAt > now
  );
  const startsAt = isExtending ? existingGrant?.grantStartsAt ?? now : now;
  const extensionBase = isExtending ? existingGrant?.grantEndsAt ?? now : now;
  const endsAt = new Date(
    extensionBase.getTime() + input.durationDays * MILLISECONDS_PER_DAY
  );

  const subscriptionData = {
    paymentProvider: "ADMIN" as const,
    source: "ADMIN_GRANT" as const,
    status: "ACTIVE" as const,
    currentPeriodEnd: endsAt,
    grantStartsAt: startsAt,
    grantEndsAt: endsAt,
    grantedByAdminId: input.adminId,
    revokedAt: null,
  };

  const subscription = existingGrant
    ? await tx.subscription.update({
        where: { id: existingGrant.id },
        data: subscriptionData,
      })
    : await tx.subscription.create({
        data: {
          dealerId: input.dealerId,
          ...subscriptionData,
        },
      });

  return {
    kind: isExtending ? ("extended" as const) : ("granted" as const),
    subscription,
  };
}

export async function revokeAdminDealerAccess(
  tx: Prisma.TransactionClient,
  dealerId: string,
  now = new Date()
) {
  return tx.subscription.updateMany({
    where: {
      dealerId,
      source: "ADMIN_GRANT",
      status: "ACTIVE",
    },
    data: {
      status: "CANCELLED",
      revokedAt: now,
    },
  });
}
