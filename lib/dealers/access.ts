import type { Prisma, UserRole } from "@prisma/client";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";

interface DealerAccessSubject {
  role: UserRole;
  dealerProfile: { id: string } | null;
}

interface DealerProfileDefaultsSubject {
  id: string;
  name: string | null;
  email: string;
}

const DEALER_ACCOUNT_ROLES: UserRole[] = ["DEALER", "ADMIN"];

export function hasDealerDashboardAccess<T extends DealerAccessSubject>(
  user: T
): user is T & { dealerProfile: NonNullable<T["dealerProfile"]> } {
  return (
    DEALER_ACCOUNT_ROLES.includes(user.role) &&
    user.dealerProfile !== null
  );
}

export function getDealerProfileDefaults(user: DealerProfileDefaultsSubject) {
  const name = getDefaultDealerName(user);

  return {
    name,
    slug: `dealer-${user.id}`,
  };
}

export function getAdminDealerWhere(): Prisma.DealerProfileWhereInput {
  return {
    user: {
      role: {
        in: DEALER_ACCOUNT_ROLES,
      },
    },
  };
}

export function getPublicDealerWhere(
  now = new Date()
): Prisma.DealerProfileWhereInput {
  return {
    subscriptions: {
      some: {
        OR: [
          getPaidSubscriptionEntitlementWhere(now),
          {
            source: "ADMIN_GRANT",
            status: "ACTIVE",
            revokedAt: null,
            grantStartsAt: { lte: now },
            grantEndsAt: { gt: now },
          },
        ],
      },
    },
    user: {
      role: {
        in: DEALER_ACCOUNT_ROLES,
      },
      disabledAt: null,
      deletedAt: null,
    },
  };
}

export async function provisionDealerProfile(
  tx: Prisma.TransactionClient,
  user: DealerProfileDefaultsSubject
) {
  const defaults = getDealerProfileDefaults(user);

  return tx.dealerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      ...defaults,
    },
  });
}

function getDefaultDealerName(user: DealerProfileDefaultsSubject) {
  const profileName = user.name?.trim();
  if (profileName && profileName.length >= 2) return profileName.slice(0, 100);

  const emailName = user.email.split("@")[0]?.trim();
  if (emailName && emailName.length >= 2) return emailName.slice(0, 100);

  return `Dealer ${user.id.slice(-6)}`;
}
