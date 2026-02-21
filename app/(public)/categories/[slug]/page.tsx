export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { CategoryFilters } from "./category-filters";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; minPrice?: string; maxPrice?: string; region?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await db.category.findUnique({ where: { slug } });
  if (!category) return {};
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title: category.name,
    description: `Browse ${category.name} listings on itrader.im.`,
    alternates: {
      canonical: `${appUrl}/categories/${slug}`,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const category = await db.category.findUnique({
    where: { slug },
    include: { children: { where: { active: true } } },
  });
  if (!category) notFound();

  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;

  const where = {
    categoryId: category.id,
    status: "LIVE" as const,
    ...(sp.region ? { region: { slug: sp.region } } : {}),
    ...(sp.minPrice ? { price: { gte: parseInt(sp.minPrice, 10) * 100 } } : {}),
    ...(sp.maxPrice ? { price: { lte: parseInt(sp.maxPrice, 10) * 100 } } : {}),
  };

  const [listings, total, regions] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        region: true,
      },
    }),
    db.listing.count({ where }),
    db.region.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
      <div className="mb-6 sm:mb-10">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          {category.name}
        </h1>
        <p className="mt-3 sm:mt-4 text-sm text-text-secondary">
          {total} listing{total !== 1 ? "s" : ""} found
        </p>
      </div>

      <div className="flex gap-6 lg:gap-8">
        <CategoryFilters
          categorySlug={slug}
          regionSlug={sp.region}
          regions={regions.map((r) => ({ label: r.name, value: r.slug }))}
          minPrice={sp.minPrice}
          maxPrice={sp.maxPrice}
        />

        <div className="flex-1 min-w-0">
          {listings.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6">
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
          ) : (
            <p className="text-center py-16 text-text-secondary">
              No listings found in this category.
            </p>
          )}

          {/* JSON-LD */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                name: `${category.name} - itrader.im`,
                description: `Browse ${category.name} listings on itrader.im.`,
                url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/categories/${slug}`,
                numberOfItems: total,
              }),
            }}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-10 flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <a
                  key={p}
                  href={`/categories/${slug}?page=${p}${sp.minPrice ? `&minPrice=${sp.minPrice}` : ""}${sp.maxPrice ? `&maxPrice=${sp.maxPrice}` : ""}`}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                    p === page
                      ? "bg-neon-red-500 text-white shadow-glow-red"
                      : "text-text-secondary hover:bg-surface-elevated"
                  }`}
                >
                  {p}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
