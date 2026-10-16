export const dynamic = "force-dynamic";

import Link from "@/components/navigation/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { getSellLandingPath } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
} from "@/components/ui/card-overlay-link";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import { isRipplePreviewRuntime } from "@/lib/payments/ripple-config";
import { isSampleCheckoutEnabled } from "@/lib/payments/sample-checkout-config";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import {
  applySampleListingVisibility,
  getSampleVisibility,
} from "@/lib/listings/sample-visibility";
import { publicListingSellerWhere } from "@/lib/listings/dealer-visibility";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";
import { findPendingDealerUpgradeOffer } from "@/lib/dealers/upgrade-offers";

const ACTIVE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;

function featuredListingState(listing: {
  status: string;
  featured?: boolean;
  payments?: Array<{ type?: string; includesFeatured?: boolean }>;
}) {
  const purchased =
    listing.featured === true ||
    (listing.payments ?? []).some(
      (payment) => payment.type === "FEATURED" || payment.includesFeatured === true,
    );
  const eligibleStatus = listing.status === "PENDING" || listing.status === "LIVE";
  return {
    canBuy: eligibleStatus && !purchased,
    pendingBenefit: listing.status === "PENDING" && purchased,
  };
}

export default async function AccountDashboardPage() {
  await expireStaleLiveListings();
  const user = await requireAcceptedUser("/account");
  const sampleVisibility = await getSampleVisibility();

  const [
    statusGroups,
    recentListings,
    recentEvents,
    favouritesCount,
    savedSearchCount,
    reviewCount,
    pendingDealerUpgrade,
    pricing,
  ] = await Promise.all([
    db.listing.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    db.listing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        price: true,
        featured: true,
        payments: {
          where: {
            status: "SUCCEEDED",
            refundedAt: null,
            OR: [{ type: "FEATURED" }, { includesFeatured: true }],
          },
          select: { type: true, includesFeatured: true },
          take: 1,
        },
      },
    }),
    db.listingStatusEvent.findMany({
      where: { listing: { userId: user.id } },
      include: {
        listing: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.favourite.count({
      where: {
        userId: user.id,
        listing: {
          AND: [
            applySampleListingVisibility({}, sampleVisibility),
            publicListingSellerWhere(undefined, sampleVisibility),
          ],
        },
      },
    }),
    db.savedSearch.count({
      where: { userId: user.id },
    }),
    db.dealerReview.count({
      where: { reviewerUserId: user.id },
    }),
    findPendingDealerUpgradeOffer(user.id),
    getMarketplacePricing(),
  ]);
  const checkoutUnavailable = isRipplePreviewRuntime() && !isSampleCheckoutEnabled();
  const featuredListings = recentListings.filter(
    (listing) => featuredListingState(listing).canBuy,
  );

  const counts = Object.fromEntries(
    statusGroups.map((item) => [item.status, item._count._all])
  );

  const totalListings = statusGroups.reduce((acc, item) => acc + item._count._all, 0);
  const activeListings = ACTIVE_STATUSES.reduce(
    (acc, status) => acc + (counts[status] ?? 0),
    0
  );
  const sellHref = getSellLandingPath(user.role) ?? "/sell";
  const savedMetrics = [
    {
      label: "Saved listings",
      value: favouritesCount,
      accent: "text-neon-blue-500",
      href: "/account/favourites",
      hint: "Open saved listings",
    },
    {
      label: "Saved searches",
      value: savedSearchCount,
      accent: "text-premium-gold-500",
      href: "/account/saved-searches",
      hint: "Open saved searches",
    },
    {
      label: "Dealer reviews",
      value: reviewCount,
      accent: "text-emerald-500",
      href: "/dealers",
      hint: "Browse dealer profiles",
    },
  ];
  const welcome =
    user.role === "DEALER"
      ? "Your dealer account advertises through dealer listings. Track progress and moderation updates here."
      : user.role === "ADMIN"
        ? "Jump into moderation from the admin area, or keep your own profile up to date."
        : "Your private account can advertise a vehicle whenever you are ready. Track progress and moderation updates here.";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
            Welcome back, {user.name || user.email}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">{welcome}</p>
        </div>
        <Button asChild>
          <Link href={sellHref}>New listing</Link>
        </Button>
      </div>

      {pendingDealerUpgrade ? (
        <Alert status="warning" className="mb-8">
          <div>
            <p className="font-semibold">Complimentary dealer upgrade ready</p>
            <p className="mt-1 leading-6">
              An administrator has offered you {pendingDealerUpgrade.durationDays} days
              of dealer access. Your private account will not change until you review
              and accept the dealer documents.
            </p>
            <Link
              href={`/account/dealer-upgrade?offer=${pendingDealerUpgrade.id}`}
              className="mt-2 inline-flex font-semibold text-text-trust hover:underline"
            >
              Review dealer upgrade
            </Link>
          </div>
        </Alert>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {savedMetrics.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.hint}
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">{item.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${item.accent}`}>{item.value}</p>
                <span className="mt-1 block text-xs text-text-trust">{item.hint}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {user.role === "USER" && !pendingDealerUpgrade ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Need a public dealer profile? Compare plans, then choose a tier on the pricing page.
            </p>
            <Link href="/pricing" className="text-sm font-semibold text-text-trust hover:underline">
              Compare plans
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {user.role === "DEALER" && user.dealerProfile ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Inventory, your public profile, and subscription stay in the dealer area.
            </p>
            <div className="flex flex-wrap gap-4 text-sm font-semibold">
              <Link href="/dealer/dashboard" className="text-text-trust hover:underline">
                Dealer dashboard
              </Link>
              <Link href="/dealer/profile" className="text-text-trust hover:underline">
                Dealer profile
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {user.role !== "USER" && !(user.role === "DEALER" && user.dealerProfile) ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Moderation, users, and marketplace oversight are in the admin area.
            </p>
            <div className="flex flex-wrap gap-4 text-sm font-semibold">
              <Link href="/admin" className="text-text-trust hover:underline">
                Admin area
              </Link>
              <Link href="/account/profile" className="text-text-trust hover:underline">
                Profile
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {totalListings > 0 ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Total Listings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-text-primary">{totalListings}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Active</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-neon-blue-500">{activeListings}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Sold</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-premium-gold-500">{counts.SOLD ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-text-secondary">Taken Down</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-text-secondary">{counts.TAKEN_DOWN ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent Listings</CardTitle>
                <Link href="/account/listings" className="text-sm text-text-trust hover:underline">
                  See all
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {featuredListings.length > 0 ? (
                  <p className="text-sm text-text-secondary">
                    Feature a listing that is awaiting review or live. Featured placement starts after approval.
                  </p>
                ) : null}
                {recentListings.length > 0 ? (
                  recentListings.map((listing) => (
                    <div
                      key={listing.id}
                      className="relative flex flex-col gap-3 rounded-md border border-border p-3"
                    >
                      <CardOverlayLink
                        href={`/listings/${listing.id}`}
                        label={`View ${listing.title}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">{listing.title}</p>
                        <p className="text-xs text-text-secondary">
                          £{(listing.price / 100).toLocaleString()} ·{" "}
                          {listing.createdAt.toLocaleDateString("en-GB")}
                        </p>
                        {featuredListingState(listing).canBuy ? (
                          <div className={cn(CARD_OVERLAY_CONTROL_CLASS, "mt-2")}>
                            <FeaturedUpgradeButton
                              listingId={listing.id}
                              featuredUpgradePricePence={pricing.featuredUpgradePence}
                              checkoutUnavailable={checkoutUnavailable}
                              pendingReview={listing.status === "PENDING"}
                              variant="inline"
                            />
                          </div>
                        ) : null}
                        {featuredListingState(listing).pendingBenefit ? (
                          <p className="mt-2 text-xs text-text-secondary">
                            Featured purchased — starts after approval
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="neutral">{listing.status}</Badge>
                        <span aria-hidden="true" className="text-sm text-text-trust">
                          View
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">
                    You have not created any listings yet.{" "}
                    <Link href={sellHref} className="text-text-trust hover:underline">
                      Create your first listing
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Status Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentEvents.length > 0 ? (
                  recentEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-border p-3">
                      <p className="text-sm text-text-primary">
                        <span className="font-medium">{event.listing.title}</span>:{" "}
                        {event.fromStatus ? `${event.fromStatus} -> ` : ""}
                        {event.toStatus}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {event.createdAt.toLocaleString("en-GB")} · {event.source}
                      </p>
                      {event.notes ? (
                        <p className="mt-1 text-xs text-text-secondary">{event.notes}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-secondary">
                    Activity will appear here as your listings move through moderation and
                    lifecycle updates.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
