export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/marketplace/search-bar";
import { ArrowRight, Tag, Car, Anchor, Music, Camera, Speaker } from "lucide-react";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  vehicles: <Car className="h-6 w-6" />,
  marine: <Anchor className="h-6 w-6" />,
  instruments: <Music className="h-6 w-6" />,
  photography: <Camera className="h-6 w-6" />,
  "hifi-home-av": <Speaker className="h-6 w-6" />,
};

export default async function HomePage() {
  const [featuredListings, categories] = await Promise.all([
    db.listing.findMany({
      where: { status: "LIVE" },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        category: true,
        region: true,
      },
    }),
    db.category.findMany({
      where: { active: true, parentId: null },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { listings: { where: { status: "LIVE" } } } } },
    }),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="bg-royal-700 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">
            The Isle of Man&apos;s Trusted Marketplace
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-royal-100">
            Buy and sell vehicles, marine, hi-fi, instruments, and more from
            trusted local sellers.
          </p>
          <div className="mx-auto mt-8 max-w-lg">
            <HomeSearchBar />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-text-primary">
            Browse Categories
          </h2>
          <Link
            href="/categories"
            className="text-sm font-medium text-text-brand hover:underline inline-flex items-center gap-1"
          >
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center transition-shadow hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-royal-50 text-royal-600">
                {CATEGORY_ICONS[cat.slug] ?? <Tag className="h-6 w-6" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {cat.name}
                </p>
                <p className="text-xs text-text-secondary">
                  {cat._count.listings} listing{cat._count.listings !== 1 ? "s" : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Listings */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-text-primary">
            Latest Listings
          </h2>
          <Link
            href="/search"
            className="text-sm font-medium text-text-brand hover:underline inline-flex items-center gap-1"
          >
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {featuredListings.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
            {featuredListings.map((listing) => (
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
          <div className="text-center py-16">
            <p className="text-text-secondary">
              No listings yet. Be the first to{" "}
              <Link href="/sell" className="text-text-brand hover:underline">
                post one
              </Link>
              !
            </p>
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="bg-surface-subtle">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-text-primary">
            Ready to Sell?
          </h2>
          <p className="mt-2 text-text-secondary">
            List your item from just £4.99 or subscribe as a dealer for
            unlimited listings.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/sell">Create Listing</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function HomeSearchBar() {
  "use client";
  return (
    <form action="/search" method="GET">
      <div className="relative">
        <input
          type="search"
          name="q"
          placeholder="Search vehicles, marine, hi-fi..."
          className="flex h-12 w-full rounded-lg bg-white/10 border border-white/20 pl-4 pr-4 text-base text-white placeholder:text-white/60 focus:outline-none focus:bg-white/20 focus:border-white/40"
        />
      </div>
    </form>
  );
}
