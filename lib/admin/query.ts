import type { ListingStatus, Prisma } from "@prisma/client";

export const ADMIN_LISTING_STATUS_FILTERS = [
  "ALL",
  "PENDING",
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

export function buildAdminListingArchiveWhere(input: {
  status: AdminListingStatusFilter;
  query: string;
}): Prisma.ListingWhereInput {
  return {
    ...(input.status !== "ALL" ? { status: input.status as ListingStatus } : {}),
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
