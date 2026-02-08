export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, Tag, AlertTriangle, ChevronRight } from "lucide-react";
import { ContactSellerForm } from "./contact-form";
import { ReportButton } from "./report-button";

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

  const listing = await db.listing.findUnique({
    where: { id },
    include: {
      images: { orderBy: { order: "asc" } },
      category: true,
      region: true,
      user: { select: { name: true, email: true } },
      dealer: { select: { name: true, slug: true, phone: true } },
      attributeValues: {
        include: { attributeDefinition: true },
      },
    },
  });

  if (!listing) notFound();

  const isExpired = listing.status === "EXPIRED";
  const isTakenDown = listing.status === "TAKEN_DOWN";
  const isVisible = listing.status === "LIVE" || listing.status === "APPROVED";

  if (isTakenDown) notFound();

  const price = listing.price / 100;
  const formattedPrice = Number.isInteger(price)
    ? `£${price.toLocaleString()}`
    : `£${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm text-slate-400" aria-label="Breadcrumb">
        <ol className="flex items-center gap-1">
          <li>
            <Link href="/" className="hover:text-slate-900 transition-colors">Home</Link>
          </li>
          <li><ChevronRight className="h-3 w-3" /></li>
          <li>
            <Link
              href={`/categories/${listing.category.slug}`}
              className="hover:text-slate-900 transition-colors"
            >
              {listing.category.name}
            </Link>
          </li>
          <li><ChevronRight className="h-3 w-3" /></li>
          <li className="text-slate-700 truncate max-w-[200px] font-medium">
            {listing.title}
          </li>
        </ol>
      </nav>

      {isExpired && (
        <div className="mb-8 flex items-center gap-2 rounded-xl bg-amber-50 px-5 py-4 text-sm text-amber-800 border border-amber-200">
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
                <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-slate-100">
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
                  <div className="grid grid-cols-4 gap-3">
                    {listing.images.slice(1, 5).map((img) => (
                      <div
                        key={img.id}
                        className="relative aspect-square overflow-hidden rounded-xl bg-slate-100"
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
              <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                No images available
              </div>
            )}
          </div>

          {/* Title + price + details */}
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
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
            </div>

            <div className="mt-8 text-sm text-slate-700 whitespace-pre-line leading-relaxed">
              {listing.description}
            </div>

            {/* Attributes */}
            {listing.attributeValues.length > 0 && (
              <div className="mt-8">
                <h2 className="section-heading-accent text-lg font-bold text-slate-900 mb-5">
                  Specifications
                </h2>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  {listing.attributeValues.map((av) => (
                    <div key={av.id} className="flex flex-col">
                      <dt className="font-medium text-slate-500">
                        {av.attributeDefinition.name}
                      </dt>
                      <dd className="text-slate-900">{av.value}</dd>
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
              <p className="text-sm font-semibold text-slate-900">
                {listing.dealer?.name ?? listing.user.name ?? "Anonymous"}
              </p>
              {listing.dealer && (
                <Button asChild variant="link" size="sm" className="p-0 h-auto">
                  <Link href={`/dealers/${listing.dealer.slug}`}>
                    View dealer profile
                  </Link>
                </Button>
              )}
              {listing.dealer?.phone && (
                <p className="text-sm text-slate-500">
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

          {isVisible && (
            <ReportButton listingId={listing.id} />
          )}
        </div>
      </div>

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
