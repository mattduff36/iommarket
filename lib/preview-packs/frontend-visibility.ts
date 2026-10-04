import { Prisma, type ListingStatus } from "@prisma/client";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import {
  PREVIEW_AUTH_USER_ID_PREFIX,
  PREVIEW_EMAIL_DOMAIN,
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
} from "@/lib/preview-packs/safety";

export interface PreviewPackDealerSignals {
  isAdminPreview?: boolean | null;
  authUserId?: string | null;
  email?: string | null;
}

export interface PreviewPackUserSignals {
  authUserId?: string | null;
  email?: string | null;
  dealerIsAdminPreview?: boolean | null;
}

export interface PreviewPackListingSignals {
  status?: ListingStatus | string | null;
  previewPackId?: string | null;
  dealerIsAdminPreview?: boolean | null;
  ownerAuthUserId?: string | null;
  ownerEmail?: string | null;
}

/** Preview packs exist on the frontend only for a verified staging deployment. */
export function previewPacksVisibleOnFrontend(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isStagingOnlyFeatureEnabled(env);
}

export function canExposePreviewPacksToViewer(input: {
  viewer?: { role: string } | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return input.viewer?.role === "ADMIN"
    && previewPacksVisibleOnFrontend(input.env);
}

export function isPreviewPackDealer(input: PreviewPackDealerSignals): boolean {
  return input.isAdminPreview === true || hasPreviewSystemIdentity(input.authUserId, input.email);
}

export function isPreviewPackUser(input: PreviewPackUserSignals): boolean {
  return input.dealerIsAdminPreview === true
    || hasPreviewSystemIdentity(input.authUserId, input.email);
}

export function isPreviewPackListing(input: PreviewPackListingSignals): boolean {
  return input.status === "ADMIN_PREVIEW"
    || hasPreviewPackId(input.previewPackId)
    || input.dealerIsAdminPreview === true
    || hasPreviewSystemIdentity(input.ownerAuthUserId, input.ownerEmail);
}

export function previewPackDealerMatchWhere(): Prisma.DealerProfileWhereInput {
  return {
    OR: [
      { isAdminPreview: true },
      { user: previewSystemUserMatchWhere() },
    ],
  };
}

export function excludePreviewPackDealersWhere(): Prisma.DealerProfileWhereInput {
  return {
    isAdminPreview: false,
    user: nonPreviewSystemUserWhere(),
  };
}

export function excludePreviewPackUsersWhere(): Prisma.UserWhereInput {
  return {
    NOT: [
      {
        email: {
          endsWith: `@${PREVIEW_EMAIL_DOMAIN}`,
          mode: "insensitive",
        },
      },
      { authUserId: { startsWith: PREVIEW_AUTH_USER_ID_PREFIX } },
      { dealerProfile: { isAdminPreview: true } },
    ],
  };
}

export function excludePreviewPackListingsWhere(): Prisma.ListingWhereInput {
  return {
    previewPackId: null,
    status: { not: "ADMIN_PREVIEW" },
    NOT: {
      OR: [
        { dealer: { is: { isAdminPreview: true } } },
        { user: previewSystemUserMatchWhere() },
      ],
    },
  };
}

/** Preview-linked rows outside the normal ADMIN_PREVIEW lifecycle. */
export function linkedPreviewPackListingWhere(): Prisma.ListingWhereInput {
  return {
    status: { not: "ADMIN_PREVIEW" },
    OR: [
      { previewPackId: { not: null } },
      { dealer: { is: { isAdminPreview: true } } },
      { user: previewSystemUserMatchWhere() },
    ],
  };
}

export function excludePreviewPackSubscriptionsWhere(): Prisma.SubscriptionWhereInput {
  return {
    dealer: excludePreviewPackDealersWhere(),
  };
}

export function productionPreviewListingViewSql(
  env: NodeJS.ProcessEnv = process.env,
): Prisma.Sql | null {
  if (previewPacksVisibleOnFrontend(env)) return null;
  const authPrefix = `${PREVIEW_AUTH_USER_ID_PREFIX}%`;
  const emailSuffix = `%@${PREVIEW_EMAIL_DOMAIN}`;
  return Prisma.sql`(
    listing."previewPackId" IS NULL
    AND listing."status" <> 'ADMIN_PREVIEW'
    AND (dealer."id" IS NULL OR dealer."isAdminPreview" = FALSE)
    AND owner."authUserId" NOT LIKE ${authPrefix}
    AND owner."email" NOT ILIKE ${emailSuffix}
    AND (
      views."viewerId" IS NULL
      OR (
        viewer."authUserId" NOT LIKE ${authPrefix}
        AND viewer."email" NOT ILIKE ${emailSuffix}
        AND (viewer_dealer."id" IS NULL OR viewer_dealer."isAdminPreview" = FALSE)
      )
    )
  )`;
}

export function previewSystemUserMatchWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { authUserId: { startsWith: PREVIEW_AUTH_USER_ID_PREFIX } },
      {
        email: {
          endsWith: `@${PREVIEW_EMAIL_DOMAIN}`,
          mode: "insensitive",
        },
      },
    ],
  };
}

function nonPreviewSystemUserWhere(): Prisma.UserWhereInput {
  return {
    NOT: previewSystemUserMatchWhere(),
  };
}

function hasPreviewSystemIdentity(
  authUserId?: string | null,
  email?: string | null,
): boolean {
  return (typeof authUserId === "string" && isPreviewSystemAuthUserId(authUserId))
    || (typeof email === "string" && isPreviewSystemEmail(email));
}

function hasPreviewPackId(previewPackId?: string | null): boolean {
  return typeof previewPackId === "string" && previewPackId.length > 0;
}
