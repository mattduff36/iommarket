import type { Prisma, UserRole } from "@prisma/client";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import {
  applySampleDealerVisibility,
  DEFAULT_SAMPLE_VISIBILITY,
  getSampleVisibility,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";
import {
  canExposePreviewPacksToViewer,
  isPreviewPackDealer,
  previewPackDealerMatchWhere,
  previewSystemUserMatchWhere,
} from "@/lib/preview-packs/frontend-visibility";

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
    isAdminPreview: false,
    user: {
      role: "DEALER",
      NOT: previewSystemUserMatchWhere(),
    },
  };
}

export function getEnabledPreviewDealerWhere(): Prisma.DealerProfileWhereInput {
  return {
    isAdminPreview: true,
    previewPack: { enabled: true },
  };
}

export function getMarketplaceDealerWhere(
  viewer?: { role: string } | null,
  now = new Date(),
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerProfileWhereInput {
  const publicWhere = getPublicDealerWhere(now, sampleVisibility, env);
  if (!canExposePreviewPacksToViewer({ viewer, env })) return publicWhere;
  const visible = { OR: [publicWhere, previewPackDealerMatchWhere()] };
  return sampleVisibility.archivedDealerIds?.length
    ? { AND: [visible, { id: { notIn: sampleVisibility.archivedDealerIds } }] }
    : visible;
}

export async function getMarketplaceDealerWhereWithSettings(
  viewer?: { role: string } | null,
  now = new Date(),
) {
  return getMarketplaceDealerWhere(viewer, now, await getSampleVisibility());
}

export function canViewMarketplaceDealerProfile(input: {
  viewer?: { role: string } | null;
  isAdminPreview: boolean;
  previewPackEnabled: boolean;
  hasEntitlement: boolean;
  visibleInStagingSnapshot?: boolean;
  authUserId?: string | null;
  email?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  if (isPreviewPackDealer(input)) {
    return canExposePreviewPacksToViewer({ viewer: input.viewer, env: input.env });
  }
  if (input.hasEntitlement || input.visibleInStagingSnapshot) return true;
  return input.viewer?.role === "ADMIN";
}

export function getPublicDealerWhere(
  now = new Date(),
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
  env: NodeJS.ProcessEnv = process.env,
): Prisma.DealerProfileWhereInput {
  const entitlement: Prisma.DealerProfileWhereInput = {
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
    }
  };
  return applySampleDealerVisibility({
    ...(sampleVisibility.visibleDealerIds?.length
      ? { OR: [entitlement, { id: { in: sampleVisibility.visibleDealerIds } }] }
      : entitlement),
    isAdminPreview: false,
    user: {
      role: {
        in: DEALER_ACCOUNT_ROLES,
      },
      disabledAt: null,
      deletedAt: null,
      NOT: previewSystemUserMatchWhere(),
    },
  }, sampleVisibility, env);
}

type DealerProfileClient = {
  dealerProfile: {
    upsert: Prisma.TransactionClient["dealerProfile"]["upsert"];
  };
};

export async function provisionDealerProfile(
  tx: DealerProfileClient,
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
