export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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
  ADMIN_LISTING_STATUS_FILTERS,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  parseAdminPage,
} from "@/lib/admin/query";
import { AdminPager } from "@/components/admin/admin-pager";

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
  const status = ADMIN_LISTING_STATUS_FILTERS.includes(
    params.status as (typeof ADMIN_LISTING_STATUS_FILTERS)[number],
  )
    ? (params.status as (typeof ADMIN_LISTING_STATUS_FILTERS)[number])
    : "PENDING";
  const query = params.q?.trim() ?? "";
  const page = parseAdminPage(params.page);
  const where = buildAdminListingArchiveWhere({ status, query });

  const [listings, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * ADMIN_LISTING_PAGE_SIZE,
      take: ADMIN_LISTING_PAGE_SIZE,
      include: {
        user: { select: { name: true, email: true } },
        category: { select: { name: true } },
        region: { select: { name: true } },
        _count: { select: { reports: true } },
        statusEvents: {
          where: { OR: [{ fromStatus: "LIVE" }, { toStatus: "LIVE" }] },
          take: 1,
          select: { id: true },
        },
      },
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
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search title or seller"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
        >
          {ADMIN_LISTING_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md border border-border px-3 text-sm"
        >
          Filter
        </button>
      </form>

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
