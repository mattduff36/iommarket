export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, Tag, AlertTriangle, Star } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ContactSellerForm } from "./contact-form";
import { ReportButton } from "./report-button";
import { ExpandableDescription } from "./expandable-description";
import { ShareLinks } from "./share-links";
import { FavouriteToggle } from "@/components/marketplace/favourite-toggle";
import { ListingCard } from "@/components/marketplace/listing-card";
import { DevFeaturedBypass } from "@/components/dev/dev-featured-bypass";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { MarkSoldButton } from "./mark-sold-button";
import { RenewListingButton } from "@/components/marketplace/renew-listing-button";
import { ListingModerationActions } from "@/components/admin/listing-moderation-actions";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";
import { ListingImageGallery } from "./listing-image-gallery";
import {
  expireStaleLiveListings,
  isListingEffectivelyExpired,
  liveListingWhere,
} from "@/lib/listings/expiry";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adminReview?: string; featured?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      title: true,
      description: true,
      price: true,
      images: { take: 1, orderBy: { order: "asc" }, select: { url: true } },
    },
  });
  if (!listing) return {};
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    openGraph: {
      title: listing.title,
      description: listing.description.slice(0, 160),
      url: `${appUrl}/listings/${id}`,
      images: listing.images[0]?.url ? [{ url: listing.images[0].url }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: listing.title,
      description: listing.description.slice(0, 160),
      images: listing.images[0]?.url ? [listing.images[0].url] : undefined,
    },
    alternates: {
      canonical: `${appUrl}/listings/${id}`,
    },
  };
}

export default async function ListingDetailPage({ params, searchParams }: Props) {
  await expireStaleLiveListings();
  const { id } = await params;
  const sp = await searchParams;
  const justUpgraded = sp.featured === "true";
  const currentUser = await getCurrentUser();

  const listing = await db.listing.findUnique({
    where: { id },
    include: {
      images: { orderBy: { order: "asc" } },
      category: true,
      region: true,
      user: { select: { name: true, email: true } },
      dealer: { select: { name: true, slug: true, phone: true, verified: true } },
      attributeValues: {
        include: { attributeDefinition: true },
      },
    },
  });

  if (!listing) notFound();

  const isExpired = isListingEffectivelyExpired({
    status: listing.status,
    expiresAt: listing.expiresAt,
  });
  const isTakenDown = listing.status === "TAKEN_DOWN";
  const isSold = listing.status === "SOLD";
  const isAdminUser = currentUser?.role === "ADMIN";
  const showAdminReviewActions = isAdminUser && sp.adminReview === "1";
  const isVisible =
    (!isExpired && (listing.status === "LIVE" || listing.status === "APPROVED")) ||
    isSold;
  const isFavourite = currentUser
    ? Boolean(
        await db.favourite.findUnique({
          where: {
            userId_listingId: {
              userId: currentUser.id,
              listingId: listing.id,
            },
          },
          select: { id: true },
        })
      )
    : false;

  if (isVisible) {
    const reqHeaders = await headers();
    const ip =
      reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      reqHeaders.get("x-real-ip") ??
      "unknown";
    const rawAnonKey = `anon:${ip}:${listing.id}`;
    const viewerHash = currentUser?.id ?? rawAnonKey;

    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentView = await db.listingView.findFirst({
      where: {
        listingId: listing.id,
        viewerHash,
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    });

    if (!recentView) {
      await db.listing.update({
        where: { id: listing.id },
        data: {
          viewCount: { increment: 1 },
          views: {
            create: {
              viewerId: currentUser?.id,
              viewerHash,
            },
          },
        },
      });
    }
  }

  if (isTakenDown && !isAdminUser) notFound();

  const price = listing.price / 100;
  const formattedPrice = Number.isInteger(price)
    ? `£${price.toLocaleString()}`
    : `£${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const similarListings = await db.listing.findMany({
    where: {
      ...liveListingWhere(),
      id: { not: listing.id },
      categoryId: listing.categoryId,
      regionId: listing.regionId,
    },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: 4,
    include: {
      images: { take: 1, orderBy: { order: "asc" } },
      category: true,
      region: true,
    },
  });

  const isOwner = currentUser && (listing.userId === currentUser.id || isAdminUser);
  const canUpgradeToFeatured =
    isOwner &&
    listing.status === "LIVE" &&
    !listing.featured &&
    (listing.dealerId !== null ||
      Boolean(
        await db.payment.findFirst({
          where: { listingId: listing.id, status: "SUCCEEDED", type: "LISTING" },
          select: { id: true },
        })
      ));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const shareUrl = `${appUrl}/listings/${listing.id}`;
  const shareText = `Check out this listing: ${listing.title}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {showAdminReviewActions ? (
        <ListingModerationActions
          listingId={listing.id}
          currentStatus={listing.status}
          featured={listing.featured}
          variant="floating"
        />
      ) : null}

      <Breadcrumbs
        items={[
          { label: listing.category.name, href: `/search?category=${listing.category.slug}` },
          { label: listing.title },
        ]}
      />

      {justUpgraded && (
        <div className="mb-8 flex items-center gap-2 rounded-lg bg-premium-gold-500/10 px-5 py-4 text-sm text-premium-gold-400 border border-premium-gold-500/30">
          <Star className="h-4 w-4 shrink-0" />
          Featured upgrade successful! Your listing will now appear in promoted positions.
        </div>
      )}

      {isExpired && (
        <div className="mb-8 flex items-center gap-2 rounded-lg bg-premium-gold-500/10 px-5 py-4 text-sm text-premium-gold-400 border border-premium-gold-500/30">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This listing has expired and is no longer active.
        </div>
      )}

      {isSold && (
        <div className="mb-8 flex items-center gap-3 rounded-lg bg-emerald-500/10 px-5 py-4 text-sm text-emerald-500 border border-emerald-500/30">
          <span className="inline-flex items-center justify-center rounded-full bg-emerald-500 text-white font-bold text-xs px-2.5 py-0.5 shrink-0">
            SOLD
          </span>
          This vehicle has been sold through itrader.im.
          {listing.soldAt && (
            <span className="text-text-secondary">
              Sold {listing.soldAt.toLocaleDateString("en-GB")}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-3">
        {/* Left: images + details */}
        <div className="lg:col-span-2 space-y-8">
          <ListingImageGallery
            images={listing.images.map((image) => ({
              id: image.id,
              url: image.url,
            }))}
            title={listing.title}
            isSold={isSold}
          />

          {/* Title + price + details */}
          <div>
            <h1 className="text-2xl font-bold text-text-primary font-heading sm:text-3xl">
              {listing.title}
            </h1>
            <div className="mt-3">
              <Badge variant="price" className="text-lg px-4 py-1.5">
                {formattedPrice}
              </Badge>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="info">
                <Tag className="mr-1 h-3 w-3" />
                {listing.category.name}
              </Badge>
              <Badge variant="neutral">
                <MapPin className="mr-1 h-3 w-3" />
                {listing.region.name}
              </Badge>
              <Badge variant="neutral">
                <Calendar className="mr-1 h-3 w-3" />
                Listed {listing.createdAt.toLocaleDateString("en-GB")}
              </Badge>
              <Badge variant="neutral">{listing.viewCount + (isVisible ? 1 : 0)} views</Badge>
            </div>

            <div className="mt-8">
              <h2 className="section-heading-accent text-lg font-bold text-text-primary mb-3">
                Description
              </h2>
              <ExpandableDescription description={listing.description} />
            </div>

            {/* Attributes */}
            {listing.attributeValues.length > 0 && (
              <div className="mt-8">
                <h2 className="section-heading-accent text-lg font-bold text-text-primary mb-5">
                  Specifications
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  {listing.attributeValues.map((av) => (
                    <div key={av.id} className="flex flex-col">
                      <dt className="font-medium text-text-secondary">
                        {av.attributeDefinition.name}
                      </dt>
                      <dd className="text-text-primary">{av.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>

        {/* Right: seller info + contact */}
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Price</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xl font-bold text-text-primary">{formattedPrice}</p>
              <p className="text-xs text-text-secondary">
                Listed {listing.createdAt.toLocaleDateString("en-GB")}
              </p>
              {listing.status === "SOLD" ? (
                <Badge variant="premium">Sold</Badge>
              ) : null}
              {isExpired ? <Badge variant="warning">Expired</Badge> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {listing.dealer ? "Dealer" : "Private Seller"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm font-semibold text-text-primary">
                {listing.dealer?.name ?? listing.user.name ?? "Anonymous"}
              </p>
              {listing.dealer && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-elevated/60 px-3 py-2">
                  {listing.dealer.verified ? (
                    <Badge variant="success" className="shrink-0">
                      Verified dealer
                    </Badge>
                  ) : null}
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs font-semibold"
                  >
                    <Link href={`/dealers/${listing.dealer.slug}`}>
                      View dealer profile
                    </Link>
                  </Button>
                </div>
              )}
              {listing.dealer?.phone && (
                <p className="text-sm text-text-secondary">
                  {listing.dealer.phone}
                </p>
              )}
            </CardContent>
          </Card>

          {isVisible && !isSold && (
            <Card>
              <CardHeader>
                <CardTitle>Contact Seller</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentUser ? (
                  <ContactSellerForm listingId={listing.id} />
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-neon-blue-500/20 bg-neon-blue-500/5 p-4">
                      <p className="text-sm font-semibold text-text-primary">
                        Sign in to message the seller
                      </p>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">
                        Create an account or sign in to contact this seller securely through itrader.im.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="w-full border border-neon-blue-500 bg-transparent font-bold uppercase italic text-neon-blue-500 hover:bg-neon-blue-500/10 hover:text-neon-blue-400"
                      >
                        <Link href={`/sign-up?next=${encodeURIComponent(`/listings/${listing.id}`)}`}>
                          Sign up
                        </Link>
                      </Button>
                      <Button asChild variant="trust" size="sm" className="w-full">
                        <Link href={`/sign-in?next=${encodeURIComponent(`/listings/${listing.id}`)}`}>
                          Sign in
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {currentUser && (
            <Card>
              <CardHeader>
                <CardTitle>Save Listing</CardTitle>
              </CardHeader>
              <CardContent>
                <FavouriteToggle
                  listingId={listing.id}
                  initialIsFavourite={isFavourite}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Share</CardTitle>
            </CardHeader>
            <CardContent>
              <ShareLinks url={shareUrl} title={listing.title} text={shareText} />
            </CardContent>
          </Card>

          {isVisible && (
            <ReportButton listingId={listing.id} />
          )}
        </div>
      </div>

      {isOwner && listing.status === "LIVE" && (
        <div className="mt-8 space-y-4">
          {canUpgradeToFeatured && (
            <FeaturedUpgradeButton listingId={listing.id} />
          )}
          {canUpgradeToFeatured &&
            process.env.NODE_ENV !== "production" && (
              <DevFeaturedBypass listingId={listing.id} />
            )}
          <p className="text-sm text-text-secondary">
            Sold the vehicle? Use this action to inform itrader.im and remove the listing from live results.
          </p>
          <MarkSoldButton listingId={listing.id} />
        </div>
      )}
      {isOwner && listing.status === "EXPIRED" && (
        <div className="mt-8">
          <RenewListingButton
            listingId={listing.id}
            flow={listing.dealerId ? "dealer" : "private"}
          />
        </div>
      )}
      {isOwner && listing.status === "DRAFT" && (
        <div className="mt-8">
          <Button asChild>
            <Link
              href={getDraftEditorHref({
                listingId: listing.id,
                dealerId: listing.dealerId,
              })}
            >
              Continue editing draft
            </Link>
          </Button>
        </div>
      )}

      {similarListings.length > 0 && (
        <section className="mt-12">
          <h2 className="section-heading-accent text-lg font-bold text-text-primary mb-5">
            Similar Listings
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            {similarListings.map((item) => (
              <ListingCard
                key={item.id}
                title={item.title}
                price={item.price / 100}
                imageSrc={item.images[0]?.url}
                location={item.region.name}
                meta={item.category.name}
                featured={item.featured}
                badge={item.featured ? "Featured" : undefined}
                href={`/listings/${item.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: listing.title,
            description: listing.description.slice(0, 500),
            image: listing.images.map((i) => i.url),
            offers: {
              "@type": "Offer",
              price: price,
              priceCurrency: "GBP",
              availability: isVisible
                ? "https://schema.org/InStock"
                : "https://schema.org/SoldOut",
            },
          }),
        }}
      />
    </div>
  );
}
