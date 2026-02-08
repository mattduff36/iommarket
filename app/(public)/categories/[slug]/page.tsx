export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { CategoryFilters } from "./category-filters";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; minPrice?: string; maxPrice?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await db.category.findUnique({ where: { slug } });
  if (!category) return {};
  return {
    title: category.name,
    description: `Browse ${category.name} listings on IOM Market.`,
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
    ...(sp.minPrice ? { price: { gte: parseInt(sp.minPrice, 10) * 100 } } : {}),
    ...(sp.maxPrice ? { price: { lte: parseInt(sp.maxPrice, 10) * 100 } } : {}),
  };

  const [listings, total] = await Promise.all([
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
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text-primary">
          {category.name}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {total} listing{total !== 1 ? "s" : ""} found
        </p>
      </div>

      <div className="flex gap-6">
        <CategoryFilters
          categorySlug={slug}
          minPrice={sp.minPrice}
          maxPrice={sp.maxPrice}
        />

        <div className="flex-1">
          {listings.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <a
                  key={p}
                  href={`/categories/${slug}?page=${p}${sp.minPrice ? `&minPrice=${sp.minPrice}` : ""}${sp.maxPrice ? `&maxPrice=${sp.maxPrice}` : ""}`}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                    p === page
                      ? "bg-primary text-primary-text"
                      : "border border-border hover:bg-slate-50"
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
