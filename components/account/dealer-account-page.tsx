import type { DealerEntitlement } from "@/lib/dealers/entitlement";
import Link from "@/components/navigation/link";
import { redirect } from "next/navigation";
import { Star } from "lucide-react";
import { AccountListingActions } from "@/components/account/account-listing-actions";
import { DealerTradeExchangeCard, type TradeDashboardActor } from "@/components/account/dealer-trade-summary";
import { CancellationRequestCard } from "@/app/(public)/dealer/dashboard/cancellation-request-card";
import { DealerCorrespondenceSettingsCard } from "@/app/(public)/dealer/dashboard/dealer-correspondence-settings";
import { DealerReviewResponseManager } from "@/app/(public)/dealer/dashboard/dealer-review-response-manager";
import { ListingOwnerStatusBadges } from "@/components/listings/owner-status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEALER_TIER_LABELS, getDealerListingCap } from "@/lib/config/dealer-tiers";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import { db } from "@/lib/db";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { getCurrentDealerEntitlement, hasOperationalDealerAccess } from "@/lib/dealers/entitlement";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { isRipplePreviewRuntime } from "@/lib/payments/ripple-config";
import { isSampleCheckoutEnabled } from "@/lib/payments/sample-checkout-config";
import { getPolicyFlags } from "@/lib/policy/flags";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { toManagedDealerReview } from "@/lib/reviews/dealer-review-client";
import { findListingsInAttributeOrder } from "@/lib/search/attribute-sort";
import {
  SELLER_LISTING_SORT_OPTIONS,
  getSearchOrderBy,
  isAttributeSearchSort,
  parseSellerListingSort,
  type SellerListingSort,
} from "@/lib/search/search-order";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { tradeStockSummary } from "@/lib/trade-exchange/maintenance";
import { loadTradeSession } from "@/lib/trade-exchange/session";

export type DealerAccountSection = "overview" | "listings" | "reviews" | "email" | "subscription";

export interface DealerListingQuery {
  q?: string;
  status?: string;
  sort?: string;
  page?: string;
}

const PAGE_SIZE = 25;
const RECENT_LISTING_LIMIT = 5;
const STATUS_FILTERS = ["ALL", "DRAFT", "PENDING", "APPROVED", "LIVE", "EXPIRED", "TAKEN_DOWN", "SOLD"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "error" | "info" | "premium"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  LIVE: "success",
  EXPIRED: "neutral",
  TAKEN_DOWN: "error",
  SOLD: "premium",
};

const listingInclude = {
  images: { take: 1, orderBy: { order: "asc" as const } },
  category: { select: { name: true } },
  region: { select: { name: true } },
  payments: {
    where: {
      status: "SUCCEEDED" as const,
      refundedAt: null,
      OR: [{ type: "FEATURED" as const }, { includesFeatured: true }],
    },
    select: { id: true },
    take: 1,
  },
};

const reviewSelect = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  response: {
    select: {
      approvedBody: true,
      version: true,
      revisions: {
        orderBy: { createdAt: "desc" as const },
        take: 5,
        select: {
          id: true,
          body: true,
          status: true,
          version: true,
          reasonCode: true,
        },
      },
    },
  },
  disputes: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      status: true,
      reasonCode: true,
      decisionReasonCode: true,
    },
  },
} as const;

function acceptedStatus(value: string | undefined): StatusFilter | null {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : null;
}

function acceptedSort(value: string | undefined): SellerListingSort | null {
  return SELLER_LISTING_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SellerListingSort)
    : null;
}

export function dealerListingsRedirectTarget(params: DealerListingQuery): string | null {
  const q = params.q?.trim() ?? "";
  const status = acceptedStatus(params.status);
  const sort = acceptedSort(params.sort);
  const pageRaw = params.page?.trim() ?? "";
  const page = /^\d+$/.test(pageRaw) ? Number(pageRaw) : null;
  if (!q && !status && !sort && page === null) return null;

  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (status && status !== "ALL") search.set("status", status);
  if (sort && sort !== "newest") search.set("sort", sort);
  if (page !== null && page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/dealer/listings?${query}` : "/dealer/listings";
}

function listingsHref(q: string, status: string, sort: string, page: number) {
  const search = new URLSearchParams();
  search.set("q", q);
  search.set("status", status);
  search.set("sort", sort);
  search.set("page", String(page));
  return `/dealer/listings?${search.toString()}`;
}

function readListingQuery(params: DealerListingQuery) {
  return {
    q: params.q?.trim() ?? "",
    status: acceptedStatus(params.status) ?? "ALL",
    sort: parseSellerListingSort(params.sort),
    page: Math.max(1, Number(params.page ?? "1") || 1),
  };
}

async function requireDealerAccount(route: string) {
  const acceptedUser = await requireAcceptedUser(route);
  if (acceptedUser.role === "ADMIN") redirect("/admin");
  if (!hasDealerDashboardAccess(acceptedUser)) redirect("/dealer/subscribe");
  if (!(await hasOperationalDealerAccess(acceptedUser))) redirect("/dealer/subscribe");
  return acceptedUser;
}

async function loadStatusCounts(dealerId: string) {
  const groups = await db.listing.groupBy({
    by: ["status"],
    where: { dealerId },
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((item) => [item.status, item._count._all]));
}

function activeSlotsUsed(counts: Record<string, number>) {
  return (counts.DRAFT ?? 0) + (counts.PENDING ?? 0) + (counts.APPROVED ?? 0) + (counts.LIVE ?? 0);
}

function PageHeading({
  title,
  intro,
  actionHref,
  actionLabel,
}: {
  title: string;
  intro: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="section-heading-accent font-heading text-2xl font-bold text-text-primary sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">{intro}</p>
      </div>
      {actionHref && actionLabel ? (
        <Button asChild>
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function InventoryStats({ counts, visibleCount }: { counts: Record<string, number>; visibleCount: number }) {
  const stats = [
    { label: "Total listings", value: visibleCount, accent: "text-text-primary" },
    { label: "Live", value: counts.LIVE ?? 0, accent: "text-neon-blue-500" },
    { label: "Pending", value: counts.PENDING ?? 0, accent: "text-premium-gold-500" },
    { label: "Drafts", value: counts.DRAFT ?? 0, accent: "text-text-secondary" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${stat.accent}`}>{stat.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EntitlementSummary({
  entitlement,
  tierLabel,
  activeSlots,
  listingCap,
  showAdminOperationalAccess,
  manageHref,
}: {
  entitlement: DealerEntitlement | null;
  tierLabel: string;
  activeSlots: number;
  listingCap: number;
  showAdminOperationalAccess: boolean;
  manageHref?: string;
}) {
  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-sm font-medium text-text-primary">Subscription:</span>
          {showAdminOperationalAccess ? (
            <Badge variant="error">Admin operational access</Badge>
          ) : entitlement ? (
            <>
              <Badge variant="success">{entitlement.source === "ADMIN_GRANT" ? "Free access" : "Active"}</Badge>
              <Badge variant="info">{tierLabel} plan</Badge>
              <span className="text-sm text-text-secondary">
                {Math.min(activeSlots, listingCap)}/{listingCap} active listing slots used
              </span>
              {entitlement.endsAt ? (
                <span className="text-sm text-text-secondary">
                  {entitlement.source === "ADMIN_GRANT" ? "Expires" : "Renews"}{" "}
                  {entitlement.endsAt.toLocaleDateString("en-GB")}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        {manageHref ? (
          <Link href={manageHref} className="text-sm text-text-trust hover:underline">
            Manage subscription
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function loadTradeCard(): Promise<{
  actor: TradeDashboardActor;
  summary: { live: number; drafts: number; enquiries: number; stale: number } | null;
} | null> {
  if (!isTradeExchangeEnabled()) return null;
  const tradeActor = (await loadTradeSession()).actor;
  if (tradeActor.kind !== "member" && tradeActor.kind !== "applicant") return null;
  const summary = tradeActor.kind === "member" ? await tradeStockSummary(tradeActor.dealerId) : null;
  return { actor: tradeActor, summary };
}

async function OverviewSection({
  user,
}: {
  user: Awaited<ReturnType<typeof requireDealerAccount>>;
}) {
  await expireStaleLiveListings();
  const dealerId = user.dealerProfile.id;
  const [counts, recent, reviewStats, entitlement, trade] = await Promise.all([
    loadStatusCounts(dealerId),
    db.listing.findMany({
      where: { dealerId },
      orderBy: { createdAt: "desc" },
      take: RECENT_LISTING_LIMIT,
      select: {
        id: true,
        title: true,
        price: true,
        status: true,
        featured: true,
        category: { select: { name: true } },
        region: { select: { name: true } },
      },
    }),
    db.dealerReview.aggregate({
      where: { dealerId, status: "APPROVED" },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    getCurrentDealerEntitlement(user),
    loadTradeCard(),
  ]);
  const profileFields = [
    user.dealerProfile.name,
    user.dealerProfile.slug,
    user.dealerProfile.bio,
    user.dealerProfile.website,
    user.dealerProfile.phone,
    user.dealerProfile.logoUrl,
  ];
  const profileCompletionPercent = Math.round(
    (profileFields.filter(Boolean).length / profileFields.length) * 100,
  );
  const averageRating = reviewStats._avg.rating ? Number(reviewStats._avg.rating.toFixed(1)) : null;
  const listingTier = entitlement?.tier ?? user.dealerProfile.tier;
  const totalListings = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div>
      <PageHeading
        title="Dealer overview"
        intro="Your stock, recent activity and dealer membership at a glance."
        actionHref="/sell/dealer"
        actionLabel="New listing"
      />
      {trade ? <DealerTradeExchangeCard actor={trade.actor} summary={trade.summary} /> : null}
      <InventoryStats counts={counts} visibleCount={totalListings} />
      <EntitlementSummary
        entitlement={entitlement}
        tierLabel={DEALER_TIER_LABELS[listingTier]}
        activeSlots={activeSlotsUsed(counts)}
        listingCap={getDealerListingCap(listingTier)}
        showAdminOperationalAccess={user.role === "ADMIN" && !entitlement}
        manageHref="/dealer/subscription"
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-neon-blue-500">{profileCompletionPercent}%</p>
            <p className="mt-1 text-sm text-text-secondary">
              Help buyers get to know your business with a complete dealer profile.
            </p>
            <Link href="/dealer/profile" className="mt-3 inline-flex text-sm text-text-trust hover:underline">
              Update profile
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="flex items-center gap-2 text-2xl font-bold text-premium-gold-500">
              <Star className="h-5 w-5" />
              {averageRating ?? "-"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {reviewStats._count._all} approved review{reviewStats._count._all === 1 ? "" : "s"}
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Link href="/dealer/reviews" className="text-sm text-text-trust hover:underline">
                Manage reviews
              </Link>
              <Link href={`/dealers/${user.dealerProfile.slug}`} className="text-sm text-text-trust hover:underline">
                View public reviews
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-text-primary">Recent listings</h2>
        <Link href="/dealer/listings" className="text-sm text-text-trust hover:underline">
          View all listings
        </Link>
      </div>
      {recent.length > 0 ? (
        <div className="w-full min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((listing) => (
                <TableRow key={listing.id}>
                  <TableCell className="max-w-[220px] truncate font-medium">
                    <Link
                      href={listingsHref(listing.title, "ALL", "newest", 1)}
                      className="text-text-trust hover:underline"
                    >
                      {listing.title}
                    </Link>
                  </TableCell>
                  <TableCell>{listing.category.name}</TableCell>
                  <TableCell>
                    <ListingOwnerStatusBadges
                      status={listing.status}
                      featured={listing.featured}
                      statusVariant={STATUS_VARIANT[listing.status] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell>£{(listing.price / 100).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          No listings yet.{" "}
          <Link href="/sell/dealer" className="text-text-trust hover:underline">
            Create a listing
          </Link>
        </p>
      )}
    </div>
  );
}

async function ListingsSection({
  user,
  searchParams,
}: {
  user: Awaited<ReturnType<typeof requireDealerAccount>>;
  searchParams?: Promise<DealerListingQuery>;
}) {
  await expireStaleLiveListings();
  const dealerId = user.dealerProfile.id;
  const params = readListingQuery(searchParams ? await searchParams : {});
  const listingWhere = {
    dealerId,
    ...(params.q ? { title: { contains: params.q, mode: "insensitive" as const } } : {}),
    ...(params.status !== "ALL" ? { status: params.status } : {}),
  };
  const skip = (params.page - 1) * PAGE_SIZE;
  const listingsQuery = isAttributeSearchSort(params.sort)
    ? findListingsInAttributeOrder({
        where: listingWhere,
        sort: params.sort,
        skip,
        take: PAGE_SIZE,
        load: (ids) =>
          db.listing.findMany({
            where: { dealerId, id: { in: ids } },
            include: listingInclude,
          }),
      })
    : db.listing.findMany({
        where: listingWhere,
        orderBy: getSearchOrderBy(params.sort),
        skip,
        take: PAGE_SIZE,
        include: listingInclude,
      });
  const [listings, totalFiltered, pricing] = await Promise.all([
    listingsQuery,
    db.listing.count({ where: listingWhere }),
    getMarketplacePricing(),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  return (
    <div>
      <PageHeading
        title="Listings"
        intro="Search, filter, and update your dealer inventory. When a vehicle sells, use Mark as sold so buyers see accurate availability. Feature a listing that is awaiting review or live. Featured placement starts after approval."
        actionHref="/sell/dealer"
        actionLabel="New listing"
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Listing filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/dealer/listings" method="get" className="grid gap-3 md:grid-cols-4">
            <input
              type="text"
              name="q"
              aria-label="Search listing title"
              defaultValue={params.q}
              placeholder="Search title..."
              className="h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
            <select
              name="status"
              aria-label="Listing status"
              defaultValue={params.status}
              className="h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              name="sort"
              aria-label="Sort listings"
              defaultValue={params.sort}
              className="h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            >
              {SELLER_LISTING_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="ghost" className="border border-border">Apply filters</Button>
          </form>
        </CardContent>
      </Card>
      {listings.length > 0 ? (
        <>
          <div className="w-full min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell className="max-w-[220px] truncate font-medium">{listing.title}</TableCell>
                    <TableCell>{listing.category.name}</TableCell>
                    <TableCell>{listing.region.name}</TableCell>
                    <TableCell>£{(listing.price / 100).toLocaleString()}</TableCell>
                    <TableCell>
                      <ListingOwnerStatusBadges
                        status={listing.status}
                        featured={listing.featured}
                        featuredPurchased={listing.payments.length > 0}
                        statusVariant={STATUS_VARIANT[listing.status] ?? "neutral"}
                      />
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {listing.expiresAt ? listing.expiresAt.toLocaleDateString("en-GB") : "-"}
                    </TableCell>
                    <TableCell>
                      <AccountListingActions
                        listingId={listing.id}
                        title={listing.title}
                        status={listing.status}
                        featured={listing.featured}
                        dealerId={listing.dealerId}
                        lifecycleRevision={listing.lifecycleRevision}
                        hasListingPayment={false}
                        featuredPurchased={listing.payments.length > 0}
                        featuredUpgradePricePence={pricing.featuredUpgradePence}
                        checkoutUnavailable={isRipplePreviewRuntime() && !isSampleCheckoutEnabled()}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-6 flex items-center justify-between text-sm">
            <p className="text-text-secondary">
              Page {params.page} of {totalPages} · {totalFiltered} result{totalFiltered === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-3">
              {params.page > 1 ? (
                <Link
                  href={listingsHref(params.q, params.status, params.sort, params.page - 1)}
                  className="text-text-trust hover:underline"
                >
                  Previous
                </Link>
              ) : (
                <span className="text-text-tertiary">Previous</span>
              )}
              {params.page < totalPages ? (
                <Link
                  href={listingsHref(params.q, params.status, params.sort, params.page + 1)}
                  className="text-text-trust hover:underline"
                >
                  Next
                </Link>
              ) : (
                <span className="text-text-tertiary">Next</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-text-secondary">
          No listings match this filter.{" "}
          <Link href="/sell/dealer" className="text-text-trust hover:underline">
            Create a listing
          </Link>
        </p>
      )}
    </div>
  );
}

async function ReviewsSection({
  user,
}: {
  user: Awaited<ReturnType<typeof requireDealerAccount>>;
}) {
  const reviews = await db.dealerReview.findMany({
    where: { dealerId: user.dealerProfile.id, status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: reviewSelect,
  });

  return (
    <div>
      <PageHeading
        title="Reviews"
        intro="Reply to approved reviews and record disputes. Responses are checked before they appear on your public profile."
      />
      <DealerReviewResponseManager reviews={reviews.map(toManagedDealerReview)} />
    </div>
  );
}

async function EmailSection({
  user,
}: {
  user: Awaited<ReturnType<typeof requireDealerAccount>>;
}) {
  const correspondence = await db.dealerCorrespondenceSettings.findUnique({
    where: { dealerId: user.dealerProfile.id },
    select: {
      verifiedEmail: true,
      pendingEmail: true,
      verificationExpiresAt: true,
      categories: true,
      copyAssignedToPrimary: true,
    },
  });

  return (
    <div>
      <PageHeading
        title="Email delivery"
        intro="Choose the verified address that receives dealer correspondence. Optional alerts and digests are separate notification preferences."
      />
      <p className="mb-6 text-sm text-text-secondary">
        <Link href="/account/notifications" className="text-text-trust hover:underline">
          Notification preferences
        </Link>{" "}
        control optional account alerts. This page sets the dealer correspondence address.
      </p>
      <DealerCorrespondenceSettingsCard
        primaryEmail={user.email}
        verifiedEmail={correspondence?.verifiedEmail ?? null}
        pendingEmail={correspondence?.pendingEmail ?? null}
        verificationExpiresAt={correspondence?.verificationExpiresAt?.toISOString() ?? null}
        categories={correspondence?.categories ?? []}
        copyAssignedToPrimary={correspondence?.copyAssignedToPrimary ?? false}
      />
    </div>
  );
}

async function SubscriptionSection({
  user,
}: {
  user: Awaited<ReturnType<typeof requireDealerAccount>>;
}) {
  const dealerId = user.dealerProfile.id;
  const [counts, entitlement] = await Promise.all([
    loadStatusCounts(dealerId),
    getCurrentDealerEntitlement(user),
  ]);
  const openCancellation =
    entitlement?.source === "PAYMENT"
      ? await db.dealerCancellationRequest.findFirst({
          where: {
            dealerId,
            status: { in: ["REQUESTED", "ACKNOWLEDGED", "RECONCILED"] },
          },
          orderBy: { requestedAt: "desc" },
        })
      : null;
  const listingTier = entitlement?.tier ?? user.dealerProfile.tier;

  return (
    <div>
      <PageHeading
        title="Subscription"
        intro="View your dealer membership, available listing spaces and renewal details."
      />
      <EntitlementSummary
        entitlement={entitlement}
        tierLabel={DEALER_TIER_LABELS[listingTier]}
        activeSlots={activeSlotsUsed(counts)}
        listingCap={getDealerListingCap(listingTier)}
        showAdminOperationalAccess={user.role === "ADMIN" && !entitlement}
      />
      {entitlement?.source === "PAYMENT" ? (
        <CancellationRequestCard
          enabled={getPolicyFlags().enableCancellationRequests}
          periodEndAt={openCancellation?.periodEndAt ?? entitlement.endsAt}
          existingStatus={openCancellation?.status ?? null}
        />
      ) : null}
    </div>
  );
}

export async function DealerAccountPage({
  section,
  route,
  searchParams,
  redirectTo = null,
}: {
  section: DealerAccountSection;
  route: string;
  searchParams?: Promise<DealerListingQuery>;
  redirectTo?: string | null;
}) {
  const user = await requireDealerAccount(route);
  if (redirectTo) redirect(redirectTo);

  if (section === "overview") return OverviewSection({ user });
  if (section === "listings") return ListingsSection({ user, searchParams });
  if (section === "reviews") return ReviewsSection({ user });
  if (section === "email") return EmailSection({ user });
  return SubscriptionSection({ user });
}
