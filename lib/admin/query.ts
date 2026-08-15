import type { ListingStatus, Prisma } from "@prisma/client";

export const ADMIN_LISTING_STATUS_FILTERS = [
  "PENDING",
  "LIVE",
  "TAKEN_DOWN",
  "REJECTED",
  "DRAFT",
  "EXPIRED",
  "SOLD",
  "ALL",
] as const;

export type AdminListingStatusFilter = (typeof ADMIN_LISTING_STATUS_FILTERS)[number];

export const ADMIN_LISTING_PAGE_SIZE = 25;

export function parseAdminPage(value?: string) {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
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
