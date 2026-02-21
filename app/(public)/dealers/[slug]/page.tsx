export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Badge } from "@/components/ui/badge";
import { Globe, Phone, Calendar } from "lucide-react";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await db.dealerProfile.findUnique({
    where: { slug },
    select: { name: true, bio: true },
  });
  if (!dealer) return {};
  return {
    title: dealer.name,
    description: dealer.bio?.slice(0, 160) ?? `View ${dealer.name}'s listings on itrader.im.`,
  };
}

export default async function DealerProfilePage({ params }: Props) {
  const { slug } = await params;

  const dealer = await db.dealerProfile.findUnique({
    where: { slug },
    include: {
      listings: {
        where: { status: "LIVE" },
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        include: {
          images: { take: 1, orderBy: { order: "asc" } },
          category: true,
          region: true,
        },
      },
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  if (!dealer) notFound();

  const isSubscribed = dealer.subscriptions.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Dealer header */}
      <div className="flex flex-col sm:flex-row items-start gap-6 mb-12 pb-10 border-b border-border">
        {dealer.logoUrl ? (
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-graphite-800 shadow-low">
            <Image
              src={dealer.logoUrl}
              alt={dealer.name}
              fill
              className="object-cover"
            />
          </div>
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-neon-blue-500/10 text-3xl font-bold text-neon-blue-500">
            {dealer.name.charAt(0)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary font-heading sm:text-3xl">
              {dealer.name}
            </h1>
            {isSubscribed && <Badge variant="success">Verified Dealer</Badge>}
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
        </div>
      </div>

      {/* Listings */}
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
              imageSrc={listing.images[0]?.url}
              location={listing.region.name}
              meta={listing.category.name}
              featured={listing.featured}
              badge={listing.featured ? "Featured" : undefined}
              href={`/listings/${listing.id}`}
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
