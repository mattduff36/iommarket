export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModerationActions } from "./moderation-actions";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { cn } from "@/lib/cn";
import {
  ADMIN_LISTING_PAGE_SIZE,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  parseAdminListingStatus,
  parseAdminPage,
  splitPendingFirstPage,
} from "@/lib/admin/query";
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
  const pendingWhere = {
    ...input.where,
    OR: [
      { status: "PENDING" as const },
      { revisions: { some: { status: "PENDING" as const } } },
    ],
  };
  const restWhere = {
    ...input.where,
    status: { not: "PENDING" as const },
    revisions: { none: { status: "PENDING" as const } },
  };
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

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await expireStaleLiveListings();
  const params = await searchParams;
  const status = parseAdminListingStatus(params.status);
  const query = params.q?.trim() ?? "";
  const page = parseAdminPage(params.page);
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
  const listingOrderBy = [{ createdAt: "desc" as const }];

  const [listings, total] =
    status === "ALL"
      ? await loadAllListingsPendingFirst({
          where,
          page,
          include: listingInclude,
          orderBy: listingOrderBy,
        })
      : await Promise.all([
          db.listing.findMany({
            where,
            orderBy: listingOrderBy,
            skip: (page - 1) * ADMIN_LISTING_PAGE_SIZE,
            take: ADMIN_LISTING_PAGE_SIZE,
            include: listingInclude,
          }),
          db.listing.count({ where }),
        ]);
  const totalPages = adminTotalPages(total, ADMIN_LISTING_PAGE_SIZE);

  function href(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    const merged = {
      status,
      q: query || undefined,
      page: String(page),
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    return `/admin/listings?${next.toString()}`;
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">
        Listing Moderation
      </h1>
      <AdminListingFilters query={query} status={status} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reports</TableHead>
            <TableHead className="min-w-[260px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const reviewHref = `/listings/${listing.id}?adminReview=1`;

            return (
              <TableRow key={listing.id} className="group">
                <TableCell className="max-w-[200px] p-0 font-medium">
                  <ListingReviewLink href={reviewHref} className="truncate font-medium">
                    {listing.title}
                    {listing.attributeValues[0]?.value === "Category N" ||
                    listing.attributeValues[0]?.value === "Category S" ? (
                      <Badge variant="energy" className="ml-2">
                        {listing.attributeValues[0].value}
                      </Badge>
                    ) : null}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0 text-text-secondary">
                  <ListingReviewLink href={reviewHref} className="text-text-secondary">
                    {listing.user.name ?? listing.user.email}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    {listing.category.name}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    £{(listing.price / 100).toLocaleString()}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    <Badge variant={STATUS_VARIANT[listing.status] ?? "neutral"}>
                      {listing.status}
                    </Badge>
                    {listing.revisions.length > 0 ? (
                      <Badge variant="warning" className="ml-1">
                        pending edit
                      </Badge>
                    ) : null}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="p-0">
                  <ListingReviewLink href={reviewHref}>
                    {listing._count.reports > 0 ? (
                      <Badge variant="error">{listing._count.reports}</Badge>
                    ) : (
                      <span className="text-text-secondary">0</span>
                    )}
                  </ListingReviewLink>
                </TableCell>
                <TableCell className="min-w-[260px]">
                  <ModerationActions
                    listingId={listing.id}
                    currentStatus={listing.status}
                    featured={listing.featured}
                    lifecycleRevision={listing.lifecycleRevision}
                    canReinstateLive={
                      listing.status === "TAKEN_DOWN" &&
                      listing.expiresAt !== null &&
                      listing.expiresAt.getTime() > Date.now() &&
                      listing.statusEvents.length > 0
                    }
                    hasPendingRevision={listing.revisions.length > 0}
                    pendingRevisionVersion={listing.revisions[0]?.version}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {listings.length === 0 && (
        <p className="text-center py-8 text-text-secondary">
          No listings to moderate.
        </p>
      )}
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => href({ page: String(nextPage) })}
      />
    </>
  );
}
