export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import { Badge } from "@/components/ui/badge";
import { ModerationActions } from "./moderation-actions";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { canReinstateLive } from "@/lib/listings/lifecycle";
import { cn } from "@/lib/cn";
import { formatAdminDate } from "@/lib/admin/format";
import {
  ADMIN_LISTING_PAGE_SIZE,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  pendingFirstListingWhere,
  parseAdminListingStatus,
  parseAdminPage,
  splitPendingFirstPage,
} from "@/lib/admin/query";
import { buildAdminListHref, parseAdminSort } from "@/lib/admin/table-state";
import {
  LISTING_TABLE_COLUMNS,
  LISTING_TABLE_SORT,
} from "@/lib/admin/table-columns";
import { listingOrderBy } from "@/lib/admin/table-order";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminListingFilters } from "@/components/admin/admin-listing-filters";

export const metadata: Metadata = { title: "Moderate Listings" };

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "error" | "info" | "premium"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  APPROVED: "info",
  LIVE: "success",
  EXPIRED: "neutral",
  TAKEN_DOWN: "error",
  REJECTED: "error",
  SOLD: "premium",
  ADMIN_PREVIEW: "info",
};

interface ListingReviewLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

async function loadAllListingsPendingFirst(input: {
  where: Prisma.ListingWhereInput;
  page: number;
  include: Prisma.ListingInclude;
  orderBy: Prisma.ListingOrderByWithRelationInput[];
}) {
  const { pendingWhere, restWhere } = pendingFirstListingWhere(input.where);
  const [pendingCount, total] = await Promise.all([
    db.listing.count({ where: pendingWhere }),
    db.listing.count({ where: input.where }),
  ]);
  const split = splitPendingFirstPage({
    page: input.page,
    pageSize: ADMIN_LISTING_PAGE_SIZE,
    pendingCount,
  });
  const [pending, rest] = await Promise.all([
    split.pending.take > 0
      ? db.listing.findMany({
          where: pendingWhere,
          orderBy: input.orderBy,
          skip: split.pending.skip,
          take: split.pending.take,
          include: input.include,
        })
      : [],
    split.rest.take > 0
      ? db.listing.findMany({
          where: restWhere,
          orderBy: input.orderBy,
          skip: split.rest.skip,
          take: split.rest.take,
          include: input.include,
        })
      : [],
  ]);

  return [[...pending, ...rest], total] as const;
}

function ListingReviewLink({ href, children, className }: ListingReviewLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      className={cn(
        "block h-full min-h-11 px-4 py-3 text-text-primary transition-colors group-hover:text-neon-blue-400",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function ReviewCell({
  column,
  href,
  className,
  children,
}: {
  column: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableCell data-column={column} className="p-0">
      <ListingReviewLink href={href} className={className}>
        {children}
      </ListingReviewLink>
    </TableCell>
  );
}

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  await expireStaleLiveListings();
  const params = await searchParams;
  const status = parseAdminListingStatus(params.status);
  const query = params.q?.trim() ?? "";
  const page = parseAdminPage(params.page);
  const sort = parseAdminSort(params, LISTING_TABLE_COLUMNS, LISTING_TABLE_SORT);
  const where = buildAdminListingArchiveWhere({ status, query });
  const listingInclude = {
    user: { select: { name: true, email: true } },
    category: { select: { name: true } },
    region: { select: { name: true } },
    attributeValues: {
      where: { attributeDefinition: { slug: "write-off-category" } },
      select: { value: true },
    },
    _count: { select: { reports: true } },
    revisions: {
      where: { status: "PENDING" as const },
      take: 1,
      select: { id: true, version: true },
    },
    statusEvents: {
      where: { OR: [{ fromStatus: "LIVE" as const }, { toStatus: "LIVE" as const }] },
      take: 1,
      select: { id: true },
    },
  };
  const orderBy = listingOrderBy(sort);

  const [listings, total] =
    status === "ALL" && !sort.explicit
      ? await loadAllListingsPendingFirst({
          where,
          page,
          include: listingInclude,
          orderBy,
        })
      : await Promise.all([
          db.listing.findMany({
            where,
            orderBy,
            skip: (page - 1) * ADMIN_LISTING_PAGE_SIZE,
            take: ADMIN_LISTING_PAGE_SIZE,
            include: listingInclude,
          }),
          db.listing.count({ where }),
        ]);
  const totalPages = adminTotalPages(total, ADMIN_LISTING_PAGE_SIZE);
  const current = {
    status,
    q: query || undefined,
    page: String(page),
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  function href(overrides: Record<string, string | undefined>) {
    return buildAdminListHref("/admin/listings", current, overrides);
  }

  return (
    <AdminColumnVisibility tableId="listings" columns={LISTING_TABLE_COLUMNS}>
      <AdminPageHeader
        title="Listing moderation"
        description="Review listing state, pending edits, and reports without leaving the queue."
        meta={<span>{total} {total === 1 ? "listing" : "listings"}</span>}
      />
      <AdminListingFilters
        query={query}
        status={status}
        sort={current.sort}
        direction={current.dir}
        tools={<AdminColumnMenu />}
      />

      <AdminTable minWidth="wide" className="min-w-[1180px]">
        <TableHeader>
          <TableRow>
            {LISTING_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/listings"
                current={current}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const reviewHref = `/listings/${listing.id}?adminReview=1`;

            return (
              <TableRow key={listing.id} className="group">
                <ReviewCell column="title" href={reviewHref} className="truncate font-medium">
                  {listing.title}
                  {listing.attributeValues[0]?.value === "Category N" ||
                  listing.attributeValues[0]?.value === "Category S" ? (
                    <Badge variant="energy" className="ml-2">
                      {listing.attributeValues[0].value}
                    </Badge>
                  ) : null}
                </ReviewCell>
                <ReviewCell column="seller" href={reviewHref} className="text-text-secondary">
                  {listing.user.name ?? listing.user.email}
                </ReviewCell>
                <ReviewCell column="category" href={reviewHref}>
                  {listing.category.name}
                </ReviewCell>
                <ReviewCell
                  column="price"
                  href={reviewHref}
                  className="text-right font-medium tabular-nums"
                >
                  £{(listing.price / 100).toLocaleString("en-GB")}
                </ReviewCell>
                <ReviewCell column="status" href={reviewHref} className={adminNumericCellClass}>
                  <Badge variant={STATUS_VARIANT[listing.status] ?? "neutral"}>
                    {listing.status}
                  </Badge>
                  {listing.revisions.length > 0 ? (
                    <Badge variant="warning" className="ml-1">
                      pending edit
                    </Badge>
                  ) : null}
                </ReviewCell>
                <ReviewCell column="reports" href={reviewHref} className="text-right">
                  {listing._count.reports > 0 ? (
                    <Badge variant="error">{listing._count.reports}</Badge>
                  ) : (
                    <span className="text-text-secondary">0</span>
                  )}
                </ReviewCell>
                <ReviewCell column="created" href={reviewHref} className={adminDateCellClass}>
                  {formatAdminDate(listing.createdAt)}
                </ReviewCell>
                <ReviewCell column="approved" href={reviewHref} className={adminDateCellClass}>
                  {formatAdminDate(listing.approvedAt)}
                </ReviewCell>
                <ReviewCell column="region" href={reviewHref} className="text-text-secondary">
                  {listing.region.name}
                </ReviewCell>
                <ReviewCell column="featured" href={reviewHref}>
                  {listing.featured ? "Yes" : "No"}
                </ReviewCell>
                <ReviewCell
                  column="views"
                  href={reviewHref}
                  className={adminNumericCellClass}
                >
                  {listing.viewCount.toLocaleString("en-GB")}
                </ReviewCell>
                <ReviewCell column="expires" href={reviewHref} className={adminDateCellClass}>
                  {formatAdminDate(listing.expiresAt)}
                </ReviewCell>
                <TableCell data-column="actions" className={adminActionsCellClass}>
                  <ModerationActions
                    listingId={listing.id}
                    listingTitle={listing.title}
                    currentStatus={listing.status}
                    featured={listing.featured}
                    lifecycleRevision={listing.lifecycleRevision}
                    canReinstateLive={canReinstateLive({
                      status: listing.status,
                      expiresAt: listing.expiresAt,
                      hasPriorLive: listing.statusEvents.length > 0,
                    })}
                    hasPendingRevision={listing.revisions.length > 0}
                    pendingRevisionVersion={listing.revisions[0]?.version}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {listings.length === 0 ? (
            <TableRow>
              <AdminTableEmpty colSpan={LISTING_TABLE_COLUMNS.length}>
                No listings match these filters.
              </AdminTableEmpty>
            </TableRow>
          ) : null}
        </TableBody>
      </AdminTable>
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => href({ page: String(nextPage) })}
      />
    </AdminColumnVisibility>
  );
}
