export const dynamic = "force-dynamic";

import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Colour palette for category banners                                */
/* ------------------------------------------------------------------ */
const BANNER_COLORS: Record<string, { bg: string; text: string }> = {
  vehicles:       { bg: "bg-royal-700",  text: "text-white" },
  marine:         { bg: "bg-sky-600",    text: "text-white" },
  "hifi-home-av": { bg: "bg-amber-500",  text: "text-white" },
  instruments:    { bg: "bg-emerald-600", text: "text-white" },
  photography:    { bg: "bg-rose-500",   text: "text-white" },
};

function bannerColor(slug: string) {
  return BANNER_COLORS[slug] ?? { bg: "bg-slate-700", text: "text-white" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default async function HomePage() {
  /* Fetch categories + latest listings per top-2 categories */
  const categories = await db.category.findMany({
    where: { active: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { listings: { where: { status: "LIVE" } } } },
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
      <section className="relative overflow-hidden bg-slate-900">
        {/* Background image */}
        <Image
          src="/images/hero-calf-of-man.png"
          alt="The Calf of Man – Isle of Man coastline"
          fill
          priority
          className="object-cover opacity-50"
          sizes="100vw"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 text-center">
          <div className="mx-auto mb-5 flex items-center justify-center">
            <Image
              src="/images/iom-flag.png"
              alt="Isle of Man flag"
              width={48}
              height={30}
              className="rounded shadow-md"
            />
          </div>
          <p className="text-sm font-semibold uppercase tracking-widest text-royal-300">
            Isle of Man Marketplace
          </p>
          <h1 className="mt-4 text-4xl font-bold text-white sm:text-5xl lg:text-6xl leading-tight">
            Buy &amp; Sell Locally
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-300">
            Vehicles, marine, hi-fi, instruments, photography and more &mdash;
            from trusted Isle of Man sellers.
          </p>

          {/* Search */}
          <form action="/search" method="GET" className="mx-auto mt-10 max-w-lg">
            <div className="relative">
              <input
                type="search"
                name="q"
                placeholder="Search listings..."
                className="h-14 w-full rounded-full bg-white pl-6 pr-32 text-base text-slate-900 placeholder:text-slate-400 shadow-lg focus:outline-none focus:ring-2 focus:ring-royal-500"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 rounded-full bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover transition-colors"
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-8">
            <Button asChild size="lg" variant="secondary">
              <Link href="/categories">Browse Categories</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ============ CATEGORY BANNERS ============ */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-2">
          {categories.slice(0, 4).map((cat) => {
            const colors = bannerColor(cat.slug);
            return (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className={`relative flex flex-col justify-center overflow-hidden rounded-2xl ${colors.bg} p-8 sm:p-10 transition-transform duration-200 hover:scale-[1.02] hover:shadow-lg`}
              >
                <h3 className={`text-2xl font-bold ${colors.text}`}>
                  {cat.name}
                </h3>
                <p className={`mt-1 text-sm ${colors.text} opacity-80`}>
                  {cat._count.listings} listing{cat._count.listings !== 1 ? "s" : ""}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-900 w-fit transition-colors hover:bg-white">
                  Shop Now
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ============ PER-CATEGORY LISTING ROWS ============ */}
      {categoryListings.map(({ category, listings }) =>
        listings.length > 0 ? (
          <section
            key={category.id}
            className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
          >
            {/* Section header with accent underline */}
            <div className="flex items-end justify-between mb-8">
              <h2 className="section-heading-accent text-2xl font-bold text-slate-900">
                {category.name}
              </h2>
              <Link
                href={`/categories/${category.slug}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-royal-700 transition-colors"
              >
                See All <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-6">
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
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-royal-600">
            For Sellers
          </p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
            Ready to Sell on the Isle of Man?
          </h2>
          <p className="mt-4 text-lg text-slate-500 leading-relaxed">
            List your item from just &pound;4.99 or subscribe as a dealer for
            unlimited listings. Simple, transparent pricing with no hidden fees.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/sell">Create a Listing</Link>
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
