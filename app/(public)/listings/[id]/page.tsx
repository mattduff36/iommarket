export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, Tag, AlertTriangle, ChevronRight } from "lucide-react";
import { ContactSellerForm } from "./contact-form";
import { ReportButton } from "./report-button";
import { FavouriteToggle } from "@/components/marketplace/favourite-toggle";
import { ListingCard } from "@/components/marketplace/listing-card";
import { DevFeaturedBypass } from "@/components/dev/dev-featured-bypass";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await db.listing.findUnique({
    where: { id },
    select: { title: true, description: true, price: true },
  });
  if (!listing) return {};
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    alternates: {
      canonical: `${appUrl}/listings/${id}`,
    },
  };
}

export default async function ListingDetailPage({ params }: Props) {
  const { id } = await params;
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

  const isExpired = listing.status === "EXPIRED";
  const isTakenDown = listing.status === "TAKEN_DOWN";
  const isVisible = listing.status === "LIVE" || listing.status === "APPROVED";
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

  if (isTakenDown) notFound();

  const price = listing.price / 100;
  const formattedPrice = Number.isInteger(price)
    ? `£${price.toLocaleString()}`
    : `£${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const similarListings = await db.listing.findMany({
    where: {
      id: { not: listing.id },
      status: "LIVE",
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const encodedUrl = encodeURIComponent(`${appUrl}/listings/${listing.id}`);
  const encodedText = encodeURIComponent(`Check out this listing: ${listing.title}`);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 sm:mb-8 text-sm text-metallic-400 overflow-hidden" aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 min-w-0">
          <li className="shrink-0">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
          </li>
          <li className="shrink-0"><ChevronRight className="h-3 w-3" /></li>
          <li className="shrink-0">
            <Link
              href={`/categories/${listing.category.slug}`}
              className="hover:text-text-primary transition-colors"
            >
              {listing.category.name}
            </Link>
          </li>
          <li className="shrink-0"><ChevronRight className="h-3 w-3" /></li>
          <li className="text-text-primary truncate min-w-0 font-medium">
            {listing.title}
          </li>
        </ol>
      </nav>

      {isExpired && (
        <div className="mb-8 flex items-center gap-2 rounded-lg bg-premium-gold-500/10 px-5 py-4 text-sm text-premium-gold-400 border border-premium-gold-500/30">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This listing has expired and is no longer active.
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-3">
        {/* Left: images + details */}
        <div className="lg:col-span-2 space-y-8">
          {/* Image gallery */}
          <div className="grid gap-3">
            {listing.images.length > 0 ? (
              <>
                <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-graphite-800">
                  <Image
                    src={listing.images[0].url}
                    alt={listing.title}
                    fill
                    className="object-cover"
                    priority
                    sizes="(max-width: 768px) 100vw, 66vw"
                  />
                </div>
                {listing.images.length > 1 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                    {listing.images.slice(1, 5).map((img) => (
                      <div
                        key={img.id}
                        className="relative aspect-square overflow-hidden rounded-lg bg-graphite-800"
                      >
                        <Image
                          src={img.url}
                          alt={listing.title}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 25vw, 16vw"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center rounded-lg bg-graphite-800 text-metallic-500">
                No images available
              </div>
            )}
          </div>

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

            <div className="mt-8 text-sm text-text-secondary whitespace-pre-line leading-relaxed">
              {listing.description}
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
        <div className="space-y-6">
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
              {listing.dealer?.verified ? (
                <Badge variant="success">Verified dealer</Badge>
              ) : null}
              {listing.dealer && (
                <Button asChild variant="link" size="sm" className="p-0 h-auto">
                  <Link href={`/dealers/${listing.dealer.slug}`}>
                    View dealer profile
                  </Link>
                </Button>
              )}
              {listing.dealer?.phone && (
                <p className="text-sm text-text-secondary">
                  {listing.dealer.phone}
                </p>
              )}
            </CardContent>
          </Card>

          {isVisible && (
            <Card>
              <CardHeader>
                <CardTitle>Contact Seller</CardTitle>
              </CardHeader>
              <CardContent>
                <ContactSellerForm listingId={listing.id} />
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
            <CardContent className="space-y-2">
              <a
                className="block text-sm text-text-trust hover:underline"
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                target="_blank"
                rel="noreferrer"
              >
                Share on Facebook
              </a>
              <a
                className="block text-sm text-text-trust hover:underline"
                href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
                target="_blank"
                rel="noreferrer"
              >
                Share on X
              </a>
            </CardContent>
          </Card>

          {isVisible && (
            <ReportButton listingId={listing.id} />
          )}
        </div>
      </div>

      {isVisible &&
        !listing.featured &&
        process.env.NODE_ENV !== "production" &&
        currentUser &&
        (listing.userId === currentUser.id || currentUser.role === "ADMIN") && (
          <div className="mt-8">
            <DevFeaturedBypass listingId={listing.id} />
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
