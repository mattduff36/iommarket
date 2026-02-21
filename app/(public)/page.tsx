export const dynamic = "force-dynamic";

import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { getMakesWithDb } from "@/lib/constants/vehicle-makes";
import { ListingCard } from "@/components/marketplace/listing-card";
import { HeroSearch } from "@/components/marketplace/hero-search";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  /* Fetch categories + latest listings per top-2 categories */
  const [categories, regions, makeDefs, modelDefs] = await Promise.all([
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
  const modelsByMake: Record<string, string[]> = {};
  makeRows.forEach((row) => {
    const model = modelByListingId.get(row.listingId);
    if (model) {
      const make = row.value;
      if (!modelsByMake[make]) modelsByMake[make] = [];
      if (!modelsByMake[make].includes(model)) modelsByMake[make].push(model);
    }
  });
  Object.keys(modelsByMake).forEach((m) => modelsByMake[m].sort());

  const dbMakes = [...new Set(makeRows.map((r) => r.value))];
  const makes = getMakesWithDb(dbMakes);

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
        className="relative min-h-[calc(100dvh-64px)] sm:min-h-[calc(100dvh-116px)] md:min-h-0 overflow-hidden"
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
    </>
  );
}
