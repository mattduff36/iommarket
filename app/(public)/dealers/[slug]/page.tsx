export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealerLogo } from "@/components/dealers/dealer-logo";
import { NAVIGABLE_CARD_LINK_CLASS } from "@/components/ui/card-overlay-link";
import { cn } from "@/lib/cn";
import { Globe, Phone, Calendar } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DealerReviewForm } from "./dealer-review-form";
import { expireStaleLiveListings } from "@/lib/listings/expiry";
import { marketplaceListingBadge, marketplaceListingWhereWithSettings } from "@/lib/listings/marketplace";
import { getSampleVisibility, isHiddenSampleDealer } from "@/lib/listings/sample-visibility";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { getDealerEntitlement } from "@/lib/dealers/entitlement";
import { canViewMarketplaceDealerProfile } from "@/lib/dealers/access";
import {
  buildDealerProfilePath,
  buildListingPath,
} from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

interface Props {
  params: Promise<{ slug: string }>;
}

function stars(rating: number) {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const currentUser = await getCurrentUser();
  const dealer = await db.dealerProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      bio: true,
      slug: true,
      tier: true,
      isAdminPreview: true,
      previewPack: { select: { enabled: true } },
      user: { select: { role: true, authUserId: true, disabledAt: true, deletedAt: true } },
    },
  });
  if (
    !dealer ||
    (dealer.user.role !== "DEALER" && dealer.user.role !== "ADMIN") ||
    dealer.user.disabledAt ||
    dealer.user.deletedAt ||
    isHiddenSampleDealer({
      authUserId: dealer.user.authUserId,
      isAdminPreview: dealer.isAdminPreview,
      sampleVisibility: await getSampleVisibility(),
    })
  ) {
    return {};
  }

  const entitlement = await getDealerEntitlement(dealer.id, dealer.tier);
  if (
    !canViewMarketplaceDealerProfile({
      viewer: currentUser,
      isAdminPreview: dealer.isAdminPreview,
      previewPackEnabled: dealer.previewPack?.enabled === true,
      hasEntitlement: Boolean(entitlement),
    })
  ) {
    return {};
  }

  const viewerOnlyUnpaidProfile =
    !entitlement && currentUser?.role === "ADMIN" && !dealer.isAdminPreview;

  return {
    title: dealer.name,
    description: dealer.bio?.slice(0, 160) ?? `View ${dealer.name}'s listings on itrader.im.`,
    alternates: {
      canonical: buildCanonicalUrl(buildDealerProfilePath(dealer.slug)),
    },
    robots:
      dealer.isAdminPreview || viewerOnlyUnpaidProfile
        ? { index: false, follow: false }
        : undefined,
  };
}

export default async function DealerProfilePage({ params }: Props) {
  await expireStaleLiveListings();
  const { slug } = await params;
  const currentUser = await getCurrentUser();
  const sampleVisibility = await getSampleVisibility();
  const liveWhere = await marketplaceListingWhereWithSettings({ viewer: currentUser });

  const dealer = await db.dealerProfile.findUnique({
    where: { slug },
    include: {
      listings: {
        where: liveWhere,
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        include: {
          images: { take: 1, orderBy: { order: "asc" }, select: listingPhotoSelect },
          category: true,
          region: true,
          attributeValues: {
            where: { attributeDefinition: { slug: "write-off-category" } },
            select: {
              value: true,
              attributeDefinition: { select: { slug: true } },
            },
          },
        },
      },
      user: {
        select: {
          role: true,
          authUserId: true,
          disabledAt: true,
          deletedAt: true,
        },
      },
      previewPack: { select: { enabled: true } },
    },
  });

  if (
    !dealer ||
    (dealer.user.role !== "DEALER" && dealer.user.role !== "ADMIN") ||
    dealer.user.disabledAt ||
    dealer.user.deletedAt ||
    isHiddenSampleDealer({
      authUserId: dealer.user.authUserId,
      isAdminPreview: dealer.isAdminPreview,
      sampleVisibility,
    })
  ) {
    notFound();
  }

  const [entitlement, reviewStats, approvedReviews] = await Promise.all([
    getDealerEntitlement(dealer.id, dealer.tier),
    db.dealerReview.aggregate({
      where: {
        dealerId: dealer.id,
        status: "APPROVED",
      },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    db.dealerReview.findMany({
      where: {
        dealerId: dealer.id,
        status: "APPROVED",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        reviewerType: true,
        reviewerName: true,
        response: {
          select: {
            approvedBody: true,
          },
        },
      },
    }),
  ]);
  if (
    !canViewMarketplaceDealerProfile({
      viewer: currentUser,
      isAdminPreview: dealer.isAdminPreview,
      previewPackEnabled: dealer.previewPack?.enabled === true,
      hasEntitlement: Boolean(entitlement),
    })
  ) {
    notFound();
  }
  const reviewCount = reviewStats._count._all;
  const averageRating = reviewStats._avg.rating
    ? Number(reviewStats._avg.rating.toFixed(1))
    : null;
  const isProfileOwner = Boolean(currentUser && currentUser.id === dealer.userId);
  const profileFields = [
    dealer.name,
    dealer.slug,
    dealer.bio,
    dealer.website,
    dealer.phone,
    dealer.logoUrl,
  ];
  const profileCompletionPercent = Math.round(
    (profileFields.filter(Boolean).length / profileFields.length) * 100
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: "Dealers", href: "/dealers" },
          { label: dealer.name, href: buildDealerProfilePath(dealer.slug) },
        ]}
      />
      {/* Dealer header */}
      <div className="flex flex-col sm:flex-row items-start gap-6 mb-12 pb-10 border-b border-border">
        <DealerLogo
          logoUrl={dealer.logoUrl}
          dealerName={dealer.name}
          className="h-24 w-24 rounded-lg bg-graphite-800 text-3xl shadow-low"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary font-heading sm:text-3xl">
              {dealer.name}
            </h1>
            {dealer.verified && <Badge variant="success">Verified Dealer</Badge>}
          </div>

          {dealer.bio && (
            <p className="mt-3 text-text-secondary leading-relaxed">{dealer.bio}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-5 text-sm text-metallic-400">
            {dealer.website && (
              <a
                href={dealer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-neon-blue-400 transition-colors"
              >
                <Globe className="h-4 w-4" /> Website
              </a>
            )}
            {dealer.phone && (
              <a
                href={`tel:${dealer.phone}`}
                className="inline-flex items-center gap-1.5 hover:text-neon-blue-400 transition-colors"
              >
                <Phone className="h-4 w-4" /> {dealer.phone}
              </a>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" /> Member since{" "}
              {dealer.createdAt.toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {dealer.phone ? <Badge variant="info">Phone Verified</Badge> : null}
            {dealer.website ? <Badge variant="info">Website Added</Badge> : null}
          </div>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Live Listings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">{dealer.listings.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Average Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-premium-gold-500">
              {averageRating ?? "-"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Approved Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-neon-blue-500">{reviewCount}</p>
          </CardContent>
        </Card>
      </div>

      {isProfileOwner ? (
        <Link
          href="/dealer/profile"
          aria-label="Manage dealer profile"
          className={cn(
            "mb-8 block rounded-lg border border-border bg-surface p-4",
            NAVIGABLE_CARD_LINK_CLASS,
          )}
        >
          <p className="text-sm font-medium text-text-primary">
            Profile completion: {profileCompletionPercent}%
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            Add more profile details to improve trust with buyers.
          </p>
          <span aria-hidden="true" className="mt-2 inline-block text-sm text-text-trust">
            Manage dealer profile
          </span>
        </Link>
      ) : null}

      {/* Listings */}
      <div className="mb-12 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-text-primary">
            Dealer Ratings
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {reviewCount > 0
              ? `${averageRating}/5 from ${reviewCount} approved review${reviewCount === 1 ? "" : "s"}`
              : "No approved reviews yet."}
          </p>

          <div className="mt-4 space-y-3">
            {approvedReviews.map((review) => (
              <div key={review.id} className="rounded-md border border-border p-3">
                <p className="text-sm text-premium-gold-500" aria-label={`${review.rating} stars`}>
                  {stars(review.rating)}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {review.reviewerType === "REGISTERED"
                    ? review.reviewerName || "Registered user"
                    : "Anonymous"}{" "}
                  · {review.createdAt.toLocaleDateString("en-GB")}
                </p>
                {review.comment ? (
                  <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">
                    {review.comment}
                  </p>
                ) : null}
                {review.comment?.trim() && review.response?.approvedBody ? (
                  <div className="mt-3 rounded-md bg-canvas/40 p-3">
                    <p className="text-xs font-medium text-text-primary">
                      Response from {dealer.name}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                      {review.response.approvedBody}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
            {approvedReviews.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Be the first to leave a rating for this dealer.
              </p>
            ) : null}
          </div>
        </div>

        {dealer.isAdminPreview ? null : <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="text-base font-semibold text-text-primary">Leave a Review</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Every review is moderated before it appears publicly. Reviews may be
            removed under our{" "}
            <Link href="/acceptable-use" className="text-text-trust hover:underline">
              Acceptable Use Policy
            </Link>
            . Read how we handle review data in our{" "}
            <Link href="/privacy" className="text-text-trust hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <div className="mt-4">
            <DealerReviewForm dealerId={dealer.id} canComment={Boolean(currentUser)} />
          </div>
        </div>}
      </div>

      <h2 className="section-heading-accent text-xl font-bold text-text-primary font-heading mb-8">
        {dealer.listings.length} Active Listing{dealer.listings.length !== 1 ? "s" : ""}
      </h2>

      {dealer.listings.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {dealer.listings.map((listing) => (
            <ListingCard
              key={listing.id}
              title={listing.title}
              price={listing.price / 100}
              photo={toListingPhotoSource(listing.images[0])}
              location={listing.region.name}
              meta={listing.category.name}
              featured={listing.featured}
              badge={marketplaceListingBadge({
                status: listing.status,
                featured: listing.featured,
              })}
              writeOffCategory={listing.attributeValues[0]?.value ?? null}
              href={buildListingPath(listing.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-center py-16 text-text-secondary">
          No active listings from this dealer.
        </p>
      )}
    </div>
  );
}
