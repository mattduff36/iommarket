export const dynamic = "force-dynamic";

import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { FeaturedListingsCarousel } from "@/components/marketplace/home/featured-listings-carousel";
import { HeroSearch } from "@/components/marketplace/hero-search";
import { HomeVehicleCheck } from "@/components/vehicle-check/home-vehicle-check";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  await expireStaleLiveListings();
  const liveWhere = liveListingWhere();
  /* Fetch categories and dealer/search datasets */
  const [categories, regions, makeDefs, modelDefs, dealers, soldCount] = await Promise.all([
    db.category.findMany({
      where: { active: true, parentId: null },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { listings: { where: liveWhere } } },
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
        _count: { select: { listings: { where: liveWhere } } },
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
            listing: liveWhere,
          },
          select: { listingId: true, value: true },
        })
      : Promise.resolve([]),
    modelIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: {
            attributeDefinitionId: { in: modelIds },
            listing: liveWhere,
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
    where: { ...liveWhere, featured: true },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      images: { take: 1, orderBy: { order: "asc" } },
      category: true,
      region: true,
    },
  });

  const featuredCarouselListings = featuredListings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    price: listing.price / 100,
    imageSrc: listing.images[0]?.url,
    location: listing.region.name,
    meta: listing.category.name,
    href: `/listings/${listing.id}`,
  }));

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
            Cars, vans, motorbikes, and motorhomes &mdash; from trusted Isle of Man sellers.
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
          <FeaturedListingsCarousel listings={featuredCarouselListings} />
        </section>
      )}

      {/* ============ DEALER SPOTLIGHTS + SELLER CTA ============ */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch">
          <div className="rounded-[28px] border border-border bg-surface p-5 sm:p-6">
            <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="section-heading-accent text-xl font-bold text-text-primary font-heading sm:text-2xl">
                  Dealer Spotlights
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Trusted Isle of Man dealers with fresh stock and active profiles.
                </p>
              </div>
              <Link
                href="/search?sellerType=dealer"
                className="shrink-0 text-sm text-text-trust transition-colors hover:text-neon-blue-400"
              >
                View all dealers
              </Link>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {dealers.map((dealer) => (
                <div
                  key={dealer.id}
                  className="flex h-full flex-col rounded-2xl border border-border bg-black/20 p-4"
                >
                  <h3 className="font-semibold text-text-primary">{dealer.name}</h3>
                  <p className="mt-2 line-clamp-4 text-sm leading-6 text-text-secondary">
                    {dealer.bio ?? "Trusted Isle of Man dealer."}
                  </p>
                  <div className="mt-auto pt-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-metallic-500">
                      {dealer._count.listings} live listings
                    </p>
                    <Link
                      href={`/dealers/${dealer.slug}`}
                      className="mt-3 inline-flex items-center text-sm text-text-trust transition-colors hover:text-neon-blue-400"
                    >
                      Visit profile
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-neon-blue-500/20 bg-[radial-gradient(circle_at_top,rgba(51,181,255,0.16),transparent_35%),linear-gradient(145deg,rgba(11,16,21,0.98),rgba(16,21,28,0.98))] p-6 text-left sm:p-8 sm:text-center lg:flex lg:flex-col lg:justify-center lg:text-left">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-neon-red-500">
              For Sellers
            </p>
            <h2 className="mt-4 text-3xl font-bold text-text-primary font-heading">
              Ready to Sell Your Vehicle?
            </h2>
            <p className="mt-4 text-base leading-7 text-text-secondary">
              List from just &pound;4.99 or subscribe as a dealer for unlimited listings with
              straightforward pricing.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Button asChild variant="energy" size="lg" className="w-full">
                <Link href="/sell">Create a Listing</Link>
              </Button>
              <Button asChild variant="trust" size="lg" className="w-full">
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ QUICK VEHICLE CHECK ============ */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
        <HomeVehicleCheck />
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
