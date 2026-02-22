export const dynamic = "force-dynamic";

import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { ListingCard } from "@/components/marketplace/listing-card";
import { HeroSearch } from "@/components/marketplace/hero-search";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  /* Fetch categories + latest listings per top-2 categories */
  const [categories, regions, makeDefs, modelDefs, dealers, soldCount] = await Promise.all([
    db.category.findMany({
      where: { active: true, parentId: null },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { listings: { where: { status: "LIVE" } } } },
      },
    }),
    db.region.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    db.attributeDefinition.findMany({
      where: { slug: "make" },
      select: { id: true },
    }),
    db.attributeDefinition.findMany({
      where: { slug: "model" },
      select: { id: true },
    }),
    db.dealerProfile.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { listings: { where: { status: "LIVE" } } } },
      },
    }),
    db.listing.count({ where: { status: "SOLD" } }),
  ]);

  const makeIds = makeDefs.map((d) => d.id);
  const modelIds = modelDefs.map((d) => d.id);

  const [makeRows, modelRows] = await Promise.all([
    makeIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: {
            attributeDefinitionId: { in: makeIds },
            listing: { status: "LIVE" },
          },
          select: { listingId: true, value: true },
        })
      : Promise.resolve([]),
    modelIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: {
            attributeDefinitionId: { in: modelIds },
            listing: { status: "LIVE" },
          },
          select: { listingId: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const modelByListingId = new Map(modelRows.map((r) => [r.listingId, r.value]));
  const modelCountsByMake: Record<string, Record<string, number>> = {};
  makeRows.forEach((row) => {
    const model = modelByListingId.get(row.listingId);
    if (model) {
      const make = row.value;
      if (!modelCountsByMake[make]) modelCountsByMake[make] = {};
      modelCountsByMake[make][model] = (modelCountsByMake[make][model] ?? 0) + 1;
    }
  });
  const modelsByMake: Record<string, string[]> = {};
  for (const [make, models] of Object.entries(modelCountsByMake)) {
    modelsByMake[make] = Object.keys(models).sort();
  }

  const makeCounts: Record<string, number> = {};
  for (const row of makeRows) {
    makeCounts[row.value] = (makeCounts[row.value] ?? 0) + 1;
  }
  const makes = Object.entries(makeCounts)
    .map(([label, count]) => ({ label, value: label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  /* Fetch featured listings across all categories */
  const featuredListings = await db.listing.findMany({
    where: { status: "LIVE", featured: true },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      images: { take: 1, orderBy: { order: "asc" } },
      category: true,
      region: true,
    },
  });

  /* Get the two largest categories for featured rows */
  const topCategories = [...categories]
    .sort((a, b) => b._count.listings - a._count.listings)
    .slice(0, 2);

  /* Fetch 4 listings per top category */
  const categoryListings = await Promise.all(
    topCategories.map(async (cat) => {
      const listings = await db.listing.findMany({
        where: { categoryId: cat.id, status: "LIVE" },
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        take: 4,
        include: {
          images: { take: 1, orderBy: { order: "asc" } },
          category: true,
          region: true,
        },
      });
      return { category: cat, listings };
    }),
  );

  return (
    <>
      {/* ============ HERO ============ */}
      <section
        className="relative min-h-[calc(100svh-64px)] sm:min-h-[calc(100svh-116px)] md:min-h-0 overflow-hidden"
        style={{ background: HERO_GRADIENT }}
      >
        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-24 lg:py-32 lg:px-8 text-center">
          <div className="mx-auto mb-8 flex items-center justify-center">
            <Image
              src="/images/logo-itrader.png"
              alt="iTrader.im – Buy · Sell · Upgrade"
              width={480}
              height={160}
              priority
              className="w-auto max-w-[320px] sm:max-w-[420px] lg:max-w-[500px] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
            />
          </div>
          <p className="mx-auto mt-3 sm:mt-5 max-w-xl text-base sm:text-lg text-metallic-400">
            Cars, vans, motorbikes and more &mdash; from trusted Isle of Man sellers.
          </p>

          <HeroSearch
            makes={makes}
            modelsByMake={modelsByMake}
            modelCountsByMake={modelCountsByMake}
            categories={categories.map((c) => ({
              label: c.name,
              value: c.slug,
              count: c._count.listings,
            }))}
            regions={regions.map((r) => ({
              label: r.name,
              value: r.slug,
            }))}
          />
        </div>
      </section>


      {/* ============ FEATURED LISTINGS ============ */}
      {featuredListings.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-6 sm:mb-8">
            <h2 className="section-heading-accent text-xl sm:text-2xl font-bold text-text-primary font-heading">
              Featured
            </h2>
            <Link
              href="/search?featured=true"
              className="inline-flex items-center gap-1 text-sm font-medium text-metallic-400 hover:text-neon-blue-400 transition-colors"
            >
              See All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            {featuredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                title={listing.title}
                price={listing.price / 100}
                imageSrc={listing.images[0]?.url}
                location={listing.region.name}
                meta={listing.category.name}
                featured
                badge="Featured"
                href={`/listings/${listing.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ============ PER-CATEGORY LISTING ROWS ============ */}
      {categoryListings.map(({ category, listings }) =>
        listings.length > 0 ? (
          <section
            key={category.id}
            className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8"
          >
            {/* Section header with accent underline */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-6 sm:mb-8">
              <h2 className="section-heading-accent text-xl sm:text-2xl font-bold text-text-primary font-heading">
                {category.name}
              </h2>
              <Link
                href={`/categories/${category.slug}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-metallic-400 hover:text-neon-blue-400 transition-colors"
              >
                See All <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
              {listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  title={listing.title}
                  price={listing.price / 100}
                  imageSrc={listing.images[0]?.url}
                  location={listing.region.name}
                  featured={listing.featured}
                  badge={listing.featured ? "Featured" : undefined}
                  href={`/listings/${listing.id}`}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}

      {/* ============ DEALER SPOTLIGHTS ============ */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="section-heading-accent text-xl sm:text-2xl font-bold text-text-primary font-heading">
            Dealer Spotlights
          </h2>
          <Link href="/search?sellerType=dealer" className="text-sm text-text-trust hover:underline">
            View all dealers
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-6">
          {dealers.map((dealer) => (
            <div key={dealer.id} className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-text-primary">{dealer.name}</h3>
              <p className="mt-2 text-sm text-text-secondary line-clamp-3">{dealer.bio ?? "Trusted Isle of Man dealer."}</p>
              <p className="mt-3 text-xs text-text-secondary">
                {dealer._count.listings} live listings
              </p>
              <Link href={`/dealers/${dealer.slug}`} className="mt-3 inline-block text-sm text-text-trust hover:underline">
                Visit profile
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ============ SOLD STAT ============ */}
      {soldCount > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-6 py-4">
            <span className="inline-flex items-center justify-center rounded-full bg-emerald-500 text-white font-bold text-xs px-2.5 py-0.5">
              SOLD
            </span>
            <p className="text-sm text-text-secondary">
              <span className="font-bold text-text-primary text-base">{soldCount.toLocaleString()}</span>{" "}
              vehicle{soldCount !== 1 ? "s" : ""} sold through itrader.im
            </p>
          </div>
        </section>
      )}

      {/* ============ CTA ============ */}
      <section className="bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:py-20 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-neon-red-500">
            For Sellers
          </p>
          <h2 className="mt-3 text-3xl font-bold text-text-primary font-heading sm:text-4xl">
            Ready to Sell Your Vehicle?
          </h2>
          <p className="mt-4 text-lg text-text-secondary leading-relaxed">
            List your vehicle from just &pound;4.99 or subscribe as a dealer for
            unlimited listings. Simple, transparent pricing with no hidden fees.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button asChild variant="energy" size="lg">
              <Link href="/sell">Create a Listing</Link>
            </Button>
            <Button asChild variant="trust" size="lg">
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h2 className="text-lg font-semibold text-text-primary">Isle of Man vehicle marketplace</h2>
        <p className="mt-3 text-sm text-text-secondary leading-relaxed">
          iTrader.im helps buyers and sellers across the Isle of Man connect through structured listings,
          transparent pricing, and moderation-first trust standards. Search by make, model, running costs,
          and location to find the right vehicle faster.
        </p>
      </section>
    </>
  );
}
