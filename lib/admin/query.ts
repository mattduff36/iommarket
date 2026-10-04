import type { ListingStatus, Prisma, UserRole } from "@prisma/client";
import {
  applySampleListingVisibility,
  applySampleUserVisibility,
  DEFAULT_SAMPLE_VISIBILITY,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";
import { excludePreviewPackUsersWhere } from "@/lib/preview-packs/frontend-visibility";

import { ADMIN_LISTING_STATUS_FILTERS, type AdminListingStatusFilter } from "./listing-status-filters";
export { ADMIN_LISTING_STATUS_FILTERS, type AdminListingStatusFilter } from "./listing-status-filters";

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
  return excludePreviewPackUsersWhere();
}

export function buildAdminUsersWhere(input: {
  query?: string;
  role?: UserRole;
  regionId?: string;
  disabled?: boolean;
  deleted?: boolean;
}, sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY): Prisma.UserWhereInput {
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
  return applySampleUserVisibility(where, sampleVisibility);
}

function listingSearchWhere(query: string): Prisma.ListingWhereInput {
  return {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
    ],
  };
}

export function buildAdminListingArchiveWhere(input: {
  status: AdminListingStatusFilter;
  query: string;
  sampleVisibility?: SampleVisibility;
}): Prisma.ListingWhereInput {
  const statusWhere: Prisma.ListingWhereInput =
    input.status === "PENDING_EDITS"
      ? { revisions: { some: { status: "PENDING" } } }
      : input.status === "PENDING"
        ? {
            OR: [
              { status: "PENDING" },
              { revisions: { some: { status: "PENDING" } } },
            ],
          }
        : input.status !== "ALL"
          ? { status: input.status as ListingStatus }
          : { status: { not: "ADMIN_PREVIEW" } };

  const queryWhere = input.query ? listingSearchWhere(input.query) : null;
  const archiveWhere = !queryWhere
    ? statusWhere
    : statusWhere.OR
      ? { AND: [statusWhere, queryWhere] }
      : { ...statusWhere, ...queryWhere };

  return applySampleListingVisibility(
    archiveWhere,
    input.sampleVisibility ?? DEFAULT_SAMPLE_VISIBILITY,
  );
}

export function pendingFirstListingWhere(where: Prisma.ListingWhereInput): {
  pendingWhere: Prisma.ListingWhereInput;
  restWhere: Prisma.ListingWhereInput;
} {
  return {
    pendingWhere: {
      AND: [
        where,
        {
          OR: [
            { status: "PENDING" },
            { revisions: { some: { status: "PENDING" } } },
          ],
        },
      ],
    },
    restWhere: {
      AND: [
        where,
        {
          status: { not: "PENDING" },
          revisions: { none: { status: "PENDING" } },
        },
      ],
    },
  };
}
