export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListingOwnerStatusBadges } from "@/components/listings/owner-status-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountListingActions } from "@/components/account/account-listing-actions";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import { isRipplePreviewRuntime } from "@/lib/payments/ripple-config";
import { isSampleCheckoutEnabled } from "@/lib/payments/sample-checkout-config";
import { Button } from "@/components/ui/button";
import { findListingsInAttributeOrder } from "@/lib/search/attribute-sort";
import {
  SELLER_LISTING_SORT_OPTIONS,
  getSearchOrderBy,
  isAttributeSearchSort,
  parseSellerListingSort,
  type SellerListingSort,
} from "@/lib/search/search-order";

const PAGE_SIZE = 20;
const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "PENDING",
  "APPROVED",
  "LIVE",
  "SOLD",
  "EXPIRED",
  "TAKEN_DOWN",
  "REJECTED",
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

function buildHref({
  status,
  sort,
  page,
}: {
  status: StatusFilter;
  sort: SellerListingSort;
  page: number;
}) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (sort !== "newest") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/account/listings?${query}` : "/account/listings";
}

interface Props {
  searchParams?: Promise<{
    status?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function AccountListingsPage({ searchParams }: Props) {
  await expireStaleLiveListings();
  const user = await requireAcceptedUser("/account/listings");

  const params = searchParams ? await searchParams : {};
  const status = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : "ALL";
  const sort = parseSellerListingSort(params.sort);
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const where = {
    userId: user.id,
    ...(status !== "ALL" ? { status } : {}),
  };

  const listingInclude = {
    category: { select: { name: true } },
    region: { select: { name: true } },
    statusEvents: {
      take: 1,
      orderBy: { createdAt: "desc" as const },
      select: { createdAt: true, fromStatus: true, toStatus: true },
    },
    payments: {
      where: {
        status: "SUCCEEDED" as const,
        refundedAt: null,
        OR: [
          { type: "LISTING" as const },
          { type: "FEATURED" as const },
          { includesFeatured: true },
        ],
      },
      select: { type: true, includesFeatured: true },
    },
  };
  const skip = (page - 1) * PAGE_SIZE;
  const listingsQuery = isAttributeSearchSort(sort)
    ? findListingsInAttributeOrder({
        where,
        sort,
        skip,
        take: PAGE_SIZE,
        load: (ids) =>
          db.listing.findMany({
            where: { id: { in: ids } },
            include: listingInclude,
          }),
      })
    : db.listing.findMany({
        where,
        orderBy: getSearchOrderBy(sort),
        skip,
        take: PAGE_SIZE,
        include: listingInclude,
      });

  const [listings, total, pricing] = await Promise.all([
    listingsQuery,
    db.listing.count({ where }),
    getMarketplacePricing(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          My Listing History
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          View all listings you have created, with latest lifecycle updates.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Once a vehicle sells, use <span className="font-medium text-text-primary">Mark as sold</span> to inform itrader.im and remove it from live results.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          A listing awaiting review cannot be edited. Withdraw its submission first
          to return it to Draft.
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Feature a listing that is awaiting review or live. Featured placement starts after approval.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((item) => (
            <Link
              key={item}
              href={buildHref({ status: item, sort, page: 1 })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                status === item
                  ? "border-neon-blue-500 bg-neon-blue-500/10 text-neon-blue-400"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {item}
            </Link>
          ))}
          <form action="/account/listings" className="ml-auto flex items-center gap-2">
            {status !== "ALL" ? <input type="hidden" name="status" value={status} /> : null}
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Sort by
              <select
                name="sort"
                defaultValue={sort}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
              >
                {SELLER_LISTING_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      {listings.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Status Change</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="font-medium max-w-[220px] truncate">
                  {listing.title}
                </TableCell>
                <TableCell>{listing.category.name}</TableCell>
                <TableCell>{listing.region.name}</TableCell>
                <TableCell>£{(listing.price / 100).toLocaleString()}</TableCell>
                <TableCell>
                  <ListingOwnerStatusBadges
                    status={listing.status}
                    featured={listing.featured}
                    featuredPurchased={listing.payments.some(
                      (payment) =>
                        payment.type === "FEATURED" || payment.includesFeatured,
                    )}
                  />
                </TableCell>
                <TableCell className="text-text-secondary text-xs">
                  {listing.statusEvents[0]
                    ? `${listing.statusEvents[0].fromStatus ?? "-"} -> ${listing.statusEvents[0].toStatus} (${listing.statusEvents[0].createdAt.toLocaleDateString("en-GB")})`
                    : "-"}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {listing.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell>
                  <AccountListingActions
                    listingId={listing.id}
                    title={listing.title}
                    status={listing.status}
                    featured={listing.featured}
                    dealerId={listing.dealerId}
                    lifecycleRevision={listing.lifecycleRevision}
                    hasListingPayment={listing.payments.some(
                      (payment) => payment.type === "LISTING",
                    )}
                    featuredPurchased={listing.payments.some(
                      (payment) =>
                        payment.type === "FEATURED" || payment.includesFeatured,
                    )}
                    featuredUpgradePricePence={pricing.featuredUpgradePence}
                    checkoutUnavailable={
                      isRipplePreviewRuntime() && !isSampleCheckoutEnabled()
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-text-secondary">
          No listings found for this filter.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between text-sm">
        <p className="text-text-secondary">
          Page {page} of {totalPages} · {total} listing{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Link
              href={buildHref({ status, sort, page: page - 1 })}
              className="text-text-trust hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span className="text-text-tertiary">Previous</span>
          )}
          {page < totalPages ? (
            <Link
              href={buildHref({ status, sort, page: page + 1 })}
              className="text-text-trust hover:underline"
            >
              Next
            </Link>
          ) : (
            <span className="text-text-tertiary">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
