export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { SearchFilters } from "./search-filters";

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    region?: string;
    minPrice?: string;
    maxPrice?: string;
    page?: string;
  }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  return {
    title: sp.q ? `Search: ${sp.q}` : "Search",
    description: "Search listings on IOM Market.",
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;

  const where = {
    status: "LIVE" as const,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { description: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(sp.category ? { category: { slug: sp.category } } : {}),
    ...(sp.region ? { region: { slug: sp.region } } : {}),
    ...(sp.minPrice ? { price: { gte: parseInt(sp.minPrice, 10) * 100 } } : {}),
    ...(sp.maxPrice ? { price: { lte: parseInt(sp.maxPrice, 10) * 100 } } : {}),
  };

  const [listings, total, categories, regions] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        category: true,
        region: true,
      },
    }),
    db.listing.count({ where }),
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
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="section-heading-accent text-3xl font-bold text-slate-900">
          {query ? `Results for "${query}"` : "All Listings"}
        </h1>
        <p className="mt-4 text-sm text-slate-500">
          {total} result{total !== 1 ? "s" : ""} found
        </p>
      </div>

      <div className="flex gap-8">
        <SearchFilters
          query={query}
          categorySlug={sp.category}
          regionSlug={sp.region}
          categories={categories.map((c) => ({
            label: c.name,
            value: c.slug,
            count: c._count.listings,
          }))}
          regions={regions.map((r) => ({
            label: r.name,
            value: r.slug,
          }))}
          minPrice={sp.minPrice}
          maxPrice={sp.maxPrice}
        />

        <div className="flex-1">
          {listings.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {listings.map((listing) => (
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
            <p className="text-center py-16 text-slate-500">
              No listings found. Try adjusting your search.
            </p>
          )}

          {totalPages > 1 && (
            <div className="mt-10 flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                const params = new URLSearchParams();
                if (query) params.set("q", query);
                if (sp.category) params.set("category", sp.category);
                if (sp.minPrice) params.set("minPrice", sp.minPrice);
                if (sp.maxPrice) params.set("maxPrice", sp.maxPrice);
                params.set("page", String(p));
                return (
                  <a
                    key={p}
                    href={`/search?${params.toString()}`}
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                      p === page
                        ? "bg-primary text-white shadow-sm"
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
