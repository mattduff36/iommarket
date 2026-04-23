export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Plus, ExternalLink, Star } from "lucide-react";
import { DevSubscriptionBypass } from "@/components/dev/dev-subscription-bypass";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { MarkSoldButton } from "./mark-sold-button";
import { RenewListingButton } from "@/components/marketplace/renew-listing-button";
import {
  DEALER_TIER_LABELS,
  getDealerListingCap,
} from "@/lib/config/dealer-tiers";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";

export const metadata: Metadata = {
  title: "Dealer Dashboard",
  description: "Manage your dealer listings on itrader.im.",
};

const STATUS_VARIANT: Record<
  string,
  "neutral" | "warning" | "success" | "error" | "info" | "premium"
> = {
  DRAFT: "neutral",
  PENDING: "warning",
  LIVE: "success",
  EXPIRED: "neutral",
  TAKEN_DOWN: "error",
  SOLD: "premium",
} as const;

const PAGE_SIZE = 25;
const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "PENDING",
  "APPROVED",
  "LIVE",
  "EXPIRED",
  "TAKEN_DOWN",
  "SOLD",
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type SortFilter = "newest" | "oldest" | "price_high" | "price_low";

function getSortOrder(sort: SortFilter) {
  if (sort === "oldest") return { createdAt: "asc" as const };
  if (sort === "price_high") return { price: "desc" as const };
  if (sort === "price_low") return { price: "asc" as const };
  return { createdAt: "desc" as const };
}

interface Props {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function DealerDashboardPage({ searchParams }: Props) {
  await expireStaleLiveListings();
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up");
  if (!user.dealerProfile) redirect("/dealer/subscribe");

  const params = searchParams ? await searchParams : {};
  const q = params.q?.trim() ?? "";
  const status = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : "ALL";
  const sort: SortFilter =
    params.sort === "oldest" ||
    params.sort === "price_high" ||
    params.sort === "price_low"
      ? params.sort
      : "newest";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const listingWhere = {
    dealerId: user.dealerProfile.id,
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    ...(status !== "ALL" ? { status } : {}),
  };

  const [listings, totalFiltered, allStatusGroups, subscription, reviewStats] = await Promise.all([
    db.listing.findMany({
      where: listingWhere,
      orderBy: getSortOrder(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        category: { select: { name: true } },
        region: { select: { name: true } },
      },
    }),
    db.listing.count({ where: listingWhere }),
    db.listing.groupBy({
      by: ["status"],
      where: { dealerId: user.dealerProfile.id },
      _count: { _all: true },
    }),
    db.subscription.findFirst({
      where: {
        dealerId: user.dealerProfile.id,
        status: "ACTIVE",
      },
    }),
    db.dealerReview.aggregate({
      where: {
        dealerId: user.dealerProfile.id,
        status: "APPROVED",
      },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(
    allStatusGroups.map((item) => [item.status, item._count._all])
  );

  const liveCount = counts.LIVE ?? 0;
  const pendingCount = counts.PENDING ?? 0;
  const draftCount = counts.DRAFT ?? 0;
  const activeSlotsUsed =
    (counts.DRAFT ?? 0) +
    (counts.PENDING ?? 0) +
    (counts.APPROVED ?? 0) +
    (counts.LIVE ?? 0);

  const profileFields = [
    user.dealerProfile.name,
    user.dealerProfile.slug,
    user.dealerProfile.bio,
    user.dealerProfile.website,
    user.dealerProfile.phone,
    user.dealerProfile.logoUrl,
  ];
  const completedProfileFields = profileFields.filter(Boolean).length;
  const profileCompletionPercent = Math.round(
    (completedProfileFields / profileFields.length) * 100
  );

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const averageRating = reviewStats._avg.rating
    ? Number(reviewStats._avg.rating.toFixed(1))
    : null;

  const listingCap = getDealerListingCap(user.dealerProfile.tier);
  const tierLabel = DEALER_TIER_LABELS[user.dealerProfile.tier];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">
            Dealer Dashboard
          </h1>
          <p className="mt-1 text-text-secondary">
            Manage your listings, dealer profile, and subscription
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/sell/dealer">
              <Plus className="h-4 w-4" />
              New Listing
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/dealers/${user.dealerProfile.slug}`}>
              <ExternalLink className="h-4 w-4" />
              View Profile
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dealer/profile">Manage Profile</Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Total Listings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {listings.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Live
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-neon-blue-500">{liveCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-premium-gold-500">
              {pendingCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Drafts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-secondary">
              {draftCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription status */}
      <Card className="mb-8">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-sm font-medium text-text-primary">
              Subscription:
            </span>
            {subscription ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="error">Inactive</Badge>
            )}
            <Badge variant="info">{tierLabel} plan</Badge>
            <span className="text-sm text-text-secondary">
              {Math.min(activeSlotsUsed, listingCap)}/{listingCap} active listing slots used
            </span>
            {subscription?.currentPeriodEnd && (
              <span className="text-sm text-text-secondary">
                Renews{" "}
                {subscription.currentPeriodEnd.toLocaleDateString("en-GB")}
              </span>
            )}
          </div>
          {!subscription && (
            <Button asChild size="sm">
              <Link href="/dealer/subscribe">Subscribe</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profile Completion</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-neon-blue-500">
              {profileCompletionPercent}%
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Complete your dealer profile to build trust and improve conversion.
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3">
              <Link href="/dealer/profile">Update Dealer Profile</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Review Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-premium-gold-500 flex items-center gap-2">
              <Star className="h-5 w-5" />
              {averageRating ?? "—"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {reviewStats._count._all} approved review
              {reviewStats._count._all === 1 ? "" : "s"}
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3">
              <Link href={`/dealers/${user.dealerProfile.slug}`}>View Public Reviews</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {!subscription && process.env.NODE_ENV !== "production" && (
        <div className="mb-8">
          <DevSubscriptionBypass />
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Listing Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-4">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search title..."
              className="h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
            <select
              name="status"
              defaultValue={status}
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
              defaultValue={sort}
              className="h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="price_high">Price high to low</option>
              <option value="price_low">Price low to high</option>
            </select>
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold text-text-primary mb-4">Your Listings</h2>

      {listings.length > 0 ? (
        <>
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
                  <TableCell className="font-medium max-w-[220px] truncate">
                    {listing.title}
                  </TableCell>
                  <TableCell>{listing.category.name}</TableCell>
                  <TableCell>{listing.region.name}</TableCell>
                  <TableCell>£{(listing.price / 100).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[listing.status] ?? "neutral"}>
                      {listing.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {listing.expiresAt
                      ? listing.expiresAt.toLocaleDateString("en-GB")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/listings/${listing.id}`}
                        className="text-sm text-text-trust hover:underline"
                      >
                        View
                      </Link>
                      {listing.status === "DRAFT" && (
                        <Link
                          href={getDraftEditorHref({
                            listingId: listing.id,
                            dealerId: listing.dealerId,
                          })}
                          className="text-sm text-text-trust hover:underline"
                        >
                          Continue editing
                        </Link>
                      )}
                      {listing.status === "LIVE" && !listing.featured && (
                        <FeaturedUpgradeButton
                          listingId={listing.id}
                          variant="inline"
                        />
                      )}
                      {listing.status === "LIVE" && (
                        <MarkSoldButton listingId={listing.id} />
                      )}
                      {listing.status === "EXPIRED" && (
                        <RenewListingButton
                          listingId={listing.id}
                          flow="dealer"
                          variant="inline"
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 flex items-center justify-between text-sm">
            <p className="text-text-secondary">
              Page {page} of {totalPages} · {totalFiltered} result
              {totalFiltered === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-3">
              {page > 1 ? (
                <Link
                  href={`/dealer/dashboard?q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&page=${page - 1}`}
                  className="text-text-trust hover:underline"
                >
                  Previous
                </Link>
              ) : (
                <span className="text-text-tertiary">Previous</span>
              )}
              {page < totalPages ? (
                <Link
                  href={`/dealer/dashboard?q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&page=${page + 1}`}
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
        <div className="text-center py-16">
          <p className="text-text-secondary">
            No listings match this filter.{" "}
            <Link href="/sell/dealer" className="text-text-trust hover:underline">
              Create a listing
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
