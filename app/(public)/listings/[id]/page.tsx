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
import { JsonLd } from "@/components/seo/json-ld";
import { ContactSellerForm } from "./contact-form";
import { ReportButton } from "./report-button";
import { ExpandableDescription } from "./expandable-description";
import { ShareLinks } from "./share-links";
import { FavouriteToggle } from "@/components/marketplace/favourite-toggle";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ListingDealerIdentity } from "@/components/dealers/listing-dealer-identity";
import { DevFeaturedBypass } from "@/components/dev/dev-featured-bypass";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { MarkSoldButton } from "./mark-sold-button";
import { RenewListingButton } from "@/components/marketplace/renew-listing-button";
import { ListingModerationActions } from "@/components/admin/listing-moderation-actions";
import { PendingRevisionReview } from "@/components/admin/pending-revision-review";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";
import { ListingImageGallery } from "./listing-image-gallery";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import {
  expireStaleLiveListings,
  isListingEffectivelyExpired,
} from "@/lib/listings/expiry";
import {
  canInspectPendingRevision,
  canViewListing,
  isAdminPreviewListing,
  isListingPubliclyVisible,
} from "@/lib/listings/visibility";
import { ADMIN_PREVIEW_BADGE, marketplaceListingWhere } from "@/lib/listings/marketplace";
import { moderationReasonLabelForHistory } from "@/lib/listings/moderation-reasons";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { buildListingPhotoUrl, buildSocialImageUrl } from "@/lib/images/cloudinary-url";
import { signPrivateCloudinaryUrl } from "@/lib/upload/cloudinary";
import { isDisclosedWriteOff, writeOffFromAttributeValues } from "@/lib/listings/write-off-category";
import { buildViewerHash } from "@/lib/privacy/viewer-hash";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";
import {
  buildListingBreadcrumbItems,
  getPublicListingDealer,
} from "@/lib/dealers/public-listing-dealer";
import { buildListingPath } from "@/lib/navigation-paths";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adminReview?: string; featured?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      title: true,
      description: true,
      price: true,
      status: true,
      expiresAt: true,
      userId: true,
      previewPack: { select: { enabled: true } },
      images: { take: 1, orderBy: { order: "asc" }, select: listingPhotoSelect },
    },
  });
  if (!listing) return {};
  if (
    !canViewListing({
      status: listing.status,
      expiresAt: listing.expiresAt,
      listingUserId: listing.userId,
      viewer: currentUser,
      previewPackEnabled: listing.previewPack?.enabled ?? false,
    })
  ) {
    return { title: "Listing unavailable" };
  }
  const canonicalUrl = buildCanonicalUrl(buildListingPath(id));
  const primaryPhoto = toListingPhotoSource(listing.images[0]);
  const socialImage = primaryPhoto
    ? signPrivateCloudinaryUrl(buildSocialImageUrl(primaryPhoto))
    : undefined;
  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    openGraph: {
      title: listing.title,
      description: listing.description.slice(0, 160),
      url: canonicalUrl,
      images: socialImage ? [{ url: socialImage, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: listing.title,
      description: listing.description.slice(0, 160),
      images: socialImage ? [socialImage] : undefined,
    },
    alternates: {
      canonical: canonicalUrl,
    },
    robots: listing.status === "ADMIN_PREVIEW" ? { index: false, follow: false } : undefined,
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
      images: { orderBy: { order: "asc" }, select: listingPhotoSelect },
      category: true,
      region: true,
      user: { select: { name: true, email: true } },
      dealer: { select: { name: true, slug: true, phone: true, verified: true } },
      previewPack: { select: { enabled: true } },
      attributeValues: {
        include: { attributeDefinition: true },
      },
    },
  });

  if (!listing) notFound();

  const writeOffCategory = writeOffFromAttributeValues(listing.attributeValues);
  const isExpired = isListingEffectivelyExpired({
    status: listing.status,
    expiresAt: listing.expiresAt,
  });
  const isTakenDown = listing.status === "TAKEN_DOWN" || listing.status === "REJECTED";
  const isSold = listing.status === "SOLD";
  const isAdminUser = currentUser?.role === "ADMIN";
  const showAdminReviewActions = canInspectPendingRevision({
    status: listing.status,
    reviewRequested: sp.adminReview === "1",
    viewer: currentUser,
  });
  const isVisible = isListingPubliclyVisible({
    status: listing.status,
    expiresAt: listing.expiresAt,
  });
  const canView = canViewListing({
    status: listing.status,
    expiresAt: listing.expiresAt,
    listingUserId: listing.userId,
    viewer: currentUser,
    previewPackEnabled: listing.previewPack?.enabled ?? false,
  });
  const isPreviewListing = isAdminPreviewListing(listing.status);
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
    const hashed = buildViewerHash({
      listingId: listing.id,
      userId: currentUser?.id,
      ip,
    });

    if (hashed) {
      const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentView = await db.listingView.findFirst({
        where: {
          listingId: listing.id,
          viewerHash: hashed.viewerHash,
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
                viewerHash: hashed.viewerHash,
                viewerHashVersion: hashed.viewerHashVersion,
              },
            },
          },
        });
      }
    }
  }

  if (!canView) notFound();
  const publicDealer = await getPublicListingDealer(listing.dealerId, new Date(), currentUser);

  const pendingRevision =
    showAdminReviewActions
      ? await db.listingRevision.findFirst({
          where: { listingId: listing.id, status: "PENDING" },
          include: {
            category: { select: { name: true } },
            region: { select: { name: true } },
            images: { orderBy: { order: "asc" }, select: listingPhotoSelect },
            attributeValues: {
              include: { attributeDefinition: { select: { name: true } } },
            },
          },
        })
      : null;

  const latestModeration = isTakenDown
    ? await db.listingStatusEvent.findFirst({
        where: {
          listingId: listing.id,
          action: { in: ["REJECT", "TAKE_DOWN", "ACCOUNT_DISABLE", "ACCOUNT_DISABLE_PENDING"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          reasonCode: true,
          moderationSubReason: true,
          moderationTaxonomyVersion: true,
          action: true,
        },
      })
    : null;

  const price = listing.price / 100;
  const formattedPrice = Number.isInteger(price)
    ? `£${price.toLocaleString()}`
    : `£${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const similarListings = await db.listing.findMany({
    where: {
      ...marketplaceListingWhere({ viewer: currentUser }),
      id: { not: listing.id },
      categoryId: listing.categoryId,
      regionId: listing.regionId,
    },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: 4,
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
  const featuredUpgradePricePence = canUpgradeToFeatured
    ? (await getMarketplacePricing()).featuredUpgradePence
    : null;

  const listingPath = buildListingPath(listing.id);
  const shareUrl = buildCanonicalUrl(listingPath);
  const shareText = `Check out this listing: ${listing.title}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {showAdminReviewActions ? (
        <ListingModerationActions
          listingId={listing.id}
          currentStatus={listing.status}
          featured={listing.featured}
          lifecycleRevision={listing.lifecycleRevision}
          canReinstateLive={
            listing.status === "TAKEN_DOWN" &&
            listing.expiresAt !== null &&
            listing.expiresAt.getTime() > Date.now() &&
            Boolean(
              await db.listingStatusEvent.findFirst({
                where: {
                  listingId: listing.id,
                  OR: [{ fromStatus: "LIVE" }, { toStatus: "LIVE" }],
                },
                select: { id: true },
              }),
            )
          }
          hasPendingRevision={Boolean(pendingRevision)}
          pendingRevisionVersion={pendingRevision?.version}
          variant="floating"
        />
      ) : null}

      <Breadcrumbs
        items={buildListingBreadcrumbItems({
          listingId: listing.id,
          listingTitle: listing.title,
          category: listing.category,
          publicDealer,
        })}
        structuredData={isVisible}
      />

      {showAdminReviewActions && pendingRevision ? (
        <PendingRevisionReview
          live={{
            title: listing.title,
            description: listing.description,
            price: listing.price,
            categoryName: listing.category.name,
            regionName: listing.region.name,
            attributes: listing.attributeValues.map((value) => ({
              name: value.attributeDefinition.name,
              value: value.value,
            })),
            imagePublicIds: listing.images.map((image) => image.publicId),
          }}
          proposed={{
            title: pendingRevision.title,
            description: pendingRevision.description,
            price: pendingRevision.price,
            categoryName: pendingRevision.category.name,
            regionName: pendingRevision.region.name,
            attributes: pendingRevision.attributeValues.map((value) => ({
              name: value.attributeDefinition.name,
              value: value.value,
            })),
            imagePublicIds: pendingRevision.images.map((image) => image.publicId),
          }}
          proposedPhotos={pendingRevision.images
            .map((image) => toListingPhotoSource(image))
            .filter((image): image is NonNullable<typeof image> => Boolean(image))}
        />
      ) : null}

      {isOwner && listing.status === "LIVE" ? (
        <div className="mb-8 rounded-lg border border-neon-blue-500/30 bg-neon-blue-500/10 px-5 py-4 text-sm text-neon-blue-400">
          You can edit this live listing. Submitted changes stay private until they are approved.
        </div>
      ) : null}

      {justUpgraded && (
        <div className="mb-8 flex items-center gap-2 rounded-lg bg-premium-gold-500/10 px-5 py-4 text-sm text-premium-gold-400 border border-premium-gold-500/30">
          <Star className="h-4 w-4 shrink-0" />
          Featured upgrade successful! Your listing will now appear in promoted positions.
        </div>
      )}

      {isTakenDown && (
        <div className="mb-8 flex items-center gap-2 rounded-lg bg-neon-red-500/10 px-5 py-4 text-sm text-neon-red-400 border border-neon-red-500/30">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This listing is not publicly visible.
          {latestModeration?.reasonCode
            ? ` Reason: ${moderationReasonLabelForHistory(
                latestModeration.reasonCode,
                latestModeration.moderationSubReason,
              )}.`
            : ""}
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
          This vehicle has been advertised on itrader.im.
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
            images={listing.images
              .map((image) => toListingPhotoSource(image))
              .filter((image): image is NonNullable<typeof image> => Boolean(image))}
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
              {isPreviewListing ? <Badge variant="warning">{ADMIN_PREVIEW_BADGE}</Badge> : null}
              {isDisclosedWriteOff(writeOffCategory) ? (
                <Badge variant="energy">{writeOffCategory} write-off</Badge>
              ) : null}
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
              {listing.dealer ? (
                <ListingDealerIdentity
                  fallbackName={listing.dealer.name}
                  phone={listing.dealer.phone}
                  publicDealer={publicDealer}
                />
              ) : (
                <p className="text-sm font-semibold text-text-primary">
                  {listing.user.name ?? "Anonymous"}
                </p>
              )}
            </CardContent>
          </Card>

          {isVisible && !isSold && !isPreviewListing && (
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
                        <Link href={`/sign-up?next=${encodeURIComponent(listingPath)}`}>
                          Sign up
                        </Link>
                      </Button>
                      <Button asChild variant="trust" size="sm" className="w-full">
                        <Link href={`/sign-in?next=${encodeURIComponent(listingPath)}`}>
                          Sign in
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {currentUser && !isPreviewListing && (
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

          {isPreviewListing ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Share</CardTitle>
            </CardHeader>
            <CardContent>
              <ShareLinks url={shareUrl} title={listing.title} text={shareText} />
            </CardContent>
          </Card>
          )}

          {isVisible && !isPreviewListing && (
            <ReportButton listingId={listing.id} />
          )}
        </div>
      </div>

      {isOwner && listing.status === "LIVE" && (
        <div className="mt-8 space-y-4">
          {canUpgradeToFeatured && (
            <FeaturedUpgradeButton
              listingId={listing.id}
              featuredUpgradePricePence={featuredUpgradePricePence!}
            />
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
      {isOwner &&
        (listing.status === "DRAFT" ||
          listing.status === "LIVE" ||
          listing.status === "TAKEN_DOWN" ||
          listing.status === "REJECTED") && (
        <div className="mt-8">
          <Button asChild>
            <Link
              href={getDraftEditorHref({
                listingId: listing.id,
                dealerId: listing.dealerId,
              })}
            >
              {listing.status === "DRAFT"
                ? "Continue editing draft"
                : listing.status === "LIVE"
                  ? "Edit listing"
                  : "Edit and resubmit"}
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
                photo={toListingPhotoSource(item.images[0])}
                location={item.region.name}
                meta={item.category.name}
                featured={item.featured}
                badge={item.status === "ADMIN_PREVIEW" ? ADMIN_PREVIEW_BADGE : item.featured ? "Featured" : undefined}
                writeOffCategory={item.attributeValues[0]?.value ?? null}
                href={buildListingPath(item.id)}
              />
            ))}
          </div>
        </section>
      )}

      {isVisible ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Product",
            name: listing.title,
            description: listing.description.slice(0, 500),
            image: listing.images
              .map((image, index) => {
                const photo = toListingPhotoSource(image);
                if (!photo) return null;
                return index === 0
                  ? signPrivateCloudinaryUrl(buildSocialImageUrl(photo))
                  : signPrivateCloudinaryUrl(
                      buildListingPhotoUrl(photo, {
                        width: 1200,
                        mode: "fit",
                        frame: "gallery",
                      }),
                    );
              })
              .filter((url): url is string => Boolean(url)),
            offers: {
              "@type": "Offer",
              price: price,
              priceCurrency: "GBP",
              availability: isSold
                ? "https://schema.org/SoldOut"
                : "https://schema.org/InStock",
            },
          }}
        />
      ) : null}
    </div>
  );
}
