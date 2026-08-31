import type { ListingStatus, Prisma, UserRole } from "@prisma/client";
import {
  PREVIEW_AUTH_USER_ID_PREFIX,
  PREVIEW_EMAIL_DOMAIN,
} from "@/lib/preview-packs/safety";

export const ADMIN_LISTING_STATUS_FILTERS = [
  "ALL",
  "PENDING",
  "PENDING_EDITS",
  "LIVE",
  "TAKEN_DOWN",
  "REJECTED",
  "DRAFT",
  "EXPIRED",
  "SOLD",
] as const;

export type AdminListingStatusFilter = (typeof ADMIN_LISTING_STATUS_FILTERS)[number];

export const ADMIN_LISTING_PAGE_SIZE = 25;

export function parseAdminListingStatus(value?: string): AdminListingStatusFilter {
  return ADMIN_LISTING_STATUS_FILTERS.includes(value as AdminListingStatusFilter)
    ? (value as AdminListingStatusFilter)
    : "ALL";
}

export function parseAdminPage(value?: string) {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function splitPendingFirstPage(input: {
  page: number;
  pageSize: number;
  pendingCount: number;
}) {
  const skip = (input.page - 1) * input.pageSize;
  if (skip >= input.pendingCount) {
    return {
      pending: { skip: 0, take: 0 },
      rest: { skip: skip - input.pendingCount, take: input.pageSize },
    };
  }

  const pendingTake = Math.min(input.pageSize, input.pendingCount - skip);
  return {
    pending: { skip, take: pendingTake },
    rest: { skip: 0, take: input.pageSize - pendingTake },
  };
}

export function adminTotalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function excludePreviewSystemUsersWhere(): Prisma.UserWhereInput {
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

export function buildAdminUsersWhere(input: {
  query?: string;
  role?: UserRole;
  regionId?: string;
  disabled?: boolean;
  deleted?: boolean;
}): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    ...excludePreviewSystemUsersWhere(),
  };
  if (input.query) {
    where.OR = [
      { email: { contains: input.query, mode: "insensitive" } },
      { name: { contains: input.query, mode: "insensitive" } },
    ];
  }
  if (input.role) where.role = input.role;
  if (input.regionId) where.regionId = input.regionId;
  if (input.disabled === true) where.disabledAt = { not: null };
  if (input.disabled === false) where.disabledAt = null;
  if (input.deleted) where.deletedAt = { not: null };
  return where;
}

export function buildAdminListingArchiveWhere(input: {
  status: AdminListingStatusFilter;
  query: string;
}): Prisma.ListingWhereInput {
  return {
    ...(input.status === "PENDING_EDITS"
      ? { revisions: { some: { status: "PENDING" as const } } }
      : input.status === "PENDING"
        ? {
            OR: [
              { status: "PENDING" as const },
              { revisions: { some: { status: "PENDING" as const } } },
            ],
          }
      : input.status !== "ALL"
        ? { status: input.status as ListingStatus }
        : { status: { not: "ADMIN_PREVIEW" } }),
    ...(input.query
      ? {
          OR: [
            { title: { contains: input.query, mode: "insensitive" as const } },
            { user: { email: { contains: input.query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}
