import { ListingTableTitle } from "@/components/account/listing-table-title";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
import { AdminTable, adminNumericCellClass } from "@/components/admin/admin-table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
const MemberListingsColumns = [
  { id: "title", label: "Title", pinned: true },
  { id: "category", label: "Category" },
  { id: "region", label: "Region" },
  { id: "price", label: "Price" },
  { id: "status", label: "Status" },
  { id: "created", label: "Created" },
  { id: "actions", label: "Actions", pinned: true },
];

export const dynamic = "force-dynamic";

import Link from "@/components/navigation/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { ListingOwnerStatusBadges } from "@/components/listings/owner-status-badges";
import {
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
import { getSellLandingPath } from "@/lib/navigation";
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

function statusLabel(status: StatusFilter) {
  if (status === "ALL") return "All";
  if (status === "TAKEN_DOWN") return "Taken down";
  return `${status.charAt(0)}${status.slice(1).toLowerCase()}`;
}

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
    ownerArchivedAt: null, stockReviewHeld: false,
    ...(status === "DRAFT" ? { OR: [{ status: "DRAFT" as const }, { revisions: { some: { status: "DRAFT" as const } } }] } : status !== "ALL" ? { status } : {}),
  };

  const listingInclude = {
    images: { take: 1, orderBy: { order: "asc" as const } },
    revisions: { where: { status: "DRAFT" as const }, select: { id: true }, take: 1 },
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
  const sellHref = getSellLandingPath(user.role) ?? "/sell";

  return (
    <div>
      <AdminPageHeader title="My listings"
          description="Listings you have created, with the latest lifecycle updates. Mark a vehicle as sold to tell itrader.im and remove it from live results. A listing awaiting review cannot be edited until you withdraw it back to Draft. You can feature a listing that is awaiting review or live; featured placement starts after approval."
          actions={<Button asChild>
          <Link href={sellHref}>New listing</Link>
        </Button>} />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Listing status">
            {STATUS_FILTERS.map((item) => (
              <Link
                key={item}
                href={buildHref({ status: item, sort, page: 1 })}
                aria-current={status === item ? "page" : undefined}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  status === item
                    ? "border-neon-blue-500 bg-neon-blue-500/10 text-neon-blue-400"
                    : "border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {statusLabel(item)}
              </Link>
            ))}
          </div>
          <form action="/account/listings" className="flex min-w-0 flex-wrap items-center gap-2">
            {status !== "ALL" ? <input type="hidden" name="status" value={status} /> : null}
            <label htmlFor="account-listings-sort" className="text-sm text-text-secondary">
              Sort
            </label>
            <select
              id="account-listings-sort"
              name="sort"
              aria-label="Sort listings"
              defaultValue={sort}
              className="h-9 min-w-36 flex-1 rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            >
              {SELLER_LISTING_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="ghost" className="border border-border">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      {listings.length > 0 ? (
        <div className="w-full min-w-0 overflow-x-auto">
        <AdminColumnVisibility tableId="member-listings" columns={MemberListingsColumns}>
            <div className="mb-2 flex justify-end"><AdminColumnMenu /></div>
            <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead data-column="title">Title</TableHead>
              <TableHead data-column="category">Category</TableHead>
              <TableHead data-column="region">Region</TableHead>
              <TableHead data-column="price" className="text-right">Price</TableHead>
              <TableHead data-column="status">Status</TableHead>
              <TableHead data-column="created">Created</TableHead>
              <TableHead data-column="actions">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell data-column="title" className="font-medium max-w-[24rem] break-words">
                  <ListingTableTitle listingId={listing.id} image={listing.images?.[0]}>{listing.title}</ListingTableTitle>
                </TableCell>
                <TableCell data-column="category">{listing.category.name}</TableCell>
                <TableCell data-column="region">{listing.region.name}</TableCell>
                <TableCell data-column="price" className={adminNumericCellClass}>£{(listing.price / 100).toLocaleString()}</TableCell>
                <TableCell data-column="status">
                  <ListingOwnerStatusBadges
                    statusDetail={listing.statusEvents[0] ? `Last status change: ${listing.statusEvents[0].fromStatus ?? "-"} → ${listing.statusEvents[0].toStatus} (${listing.statusEvents[0].createdAt.toLocaleDateString("en-GB")})` : undefined}
                    status={listing.status}
                    featured={listing.featured}
                    featuredPurchased={listing.payments.some(
                      (payment) =>
                        payment.type === "FEATURED" || payment.includesFeatured,
                    )}
                  />
                  {listing.revisions.length > 0 && <span className="mt-1 block text-xs font-medium text-neon-blue-400">Draft changes to review</span>}
                </TableCell>
                <TableCell data-column="created" className="text-text-secondary">
                  {listing.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell data-column="actions">
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
        </AdminTable>
          </AdminColumnVisibility>
        </div>
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
