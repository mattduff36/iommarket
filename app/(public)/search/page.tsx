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
    make?: string;
    model?: string;
    minMileage?: string;
    maxMileage?: string;
    minYear?: string;
    maxYear?: string;
    page?: string;
  }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  return {
    title: sp.q ? `Search: ${sp.q}` : "Search",
    description: "Search vehicles on itrader.im. Cars, vans, motorbikes across the Isle of Man.",
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;

  const minPricePence = sp.minPrice ? parseInt(sp.minPrice, 10) * 100 : undefined;
  const maxPricePence = sp.maxPrice ? parseInt(sp.maxPrice, 10) * 100 : undefined;
  const minMileage = sp.minMileage ? parseInt(sp.minMileage, 10) : undefined;
  const maxMileage = sp.maxMileage ? parseInt(sp.maxMileage, 10) : undefined;
  const minYear = sp.minYear ? parseInt(sp.minYear, 10) : undefined;
  const maxYear = sp.maxYear ? parseInt(sp.maxYear, 10) : undefined;

  const hasMileageFilter = minMileage !== undefined || maxMileage !== undefined;
  const hasYearFilter = minYear !== undefined || maxYear !== undefined;

  let listingIdsFromAttributes: string[] | null = null;
  if (hasMileageFilter || hasYearFilter) {
    const { Prisma } = await import("@prisma/client");
    const result = await db.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM listings l
      WHERE l.status = 'LIVE'
      AND (${hasMileageFilter ? Prisma.sql`EXISTS (
        SELECT 1 FROM listing_attribute_values lav
        INNER JOIN attribute_definitions ad ON ad.id = lav.attribute_definition_id
        WHERE lav.listing_id = l.id AND ad.slug = 'mileage'
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) >= ${minMileage ?? 0}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) <= ${maxMileage ?? 999999}
      )` : Prisma.sql`TRUE`})
      AND (${hasYearFilter ? Prisma.sql`EXISTS (
        SELECT 1 FROM listing_attribute_values lav
        INNER JOIN attribute_definitions ad ON ad.id = lav.attribute_definition_id
        WHERE lav.listing_id = l.id AND ad.slug = 'year'
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) >= ${minYear ?? 0}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) <= ${maxYear ?? 9999}
      )` : Prisma.sql`TRUE`})
    `;
    listingIdsFromAttributes = result.map((r) => r.id);
  }

  const where = {
    status: "LIVE" as const,
    ...(listingIdsFromAttributes !== null
      ? { id: { in: listingIdsFromAttributes } }
      : {}),
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
    ...(minPricePence !== undefined || maxPricePence !== undefined
      ? {
          price: {
            ...(minPricePence !== undefined ? { gte: minPricePence } : {}),
            ...(maxPricePence !== undefined ? { lte: maxPricePence } : {}),
          },
        }
      : {}),
    ...(sp.make
      ? {
          attributeValues: {
            some: {
              attributeDefinition: { slug: "make" },
              value: { equals: sp.make, mode: "insensitive" as const },
            },
          },
        }
      : {}),
    ...(sp.model
      ? {
          attributeValues: {
            some: {
              attributeDefinition: { slug: "model" },
              value: { equals: sp.model, mode: "insensitive" as const },
            },
          },
        }
      : {}),
  };

  const [listings, total, categories, regions, makeDefs, modelDefs] = await Promise.all([
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
  const [makeValues, modelValues] = await Promise.all([
    makeIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: { attributeDefinitionId: { in: makeIds } },
          select: { value: true },
          distinct: ["value"],
        })
      : Promise.resolve([]),
    modelIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: { attributeDefinitionId: { in: modelIds } },
          select: { value: true },
          distinct: ["value"],
        })
      : Promise.resolve([]),
  ]);
  const makes = [...new Set(makeValues.map((r) => r.value))].sort();
  const models = [...new Set(modelValues.map((r) => r.value))].sort();

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
          make={sp.make}
          model={sp.model}
          minMileage={sp.minMileage}
          maxMileage={sp.maxMileage}
          minYear={sp.minYear}
          maxYear={sp.maxYear}
          makes={makes}
          models={models}
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
                if (sp.make) params.set("make", sp.make);
                if (sp.model) params.set("model", sp.model);
                if (sp.minMileage) params.set("minMileage", sp.minMileage);
                if (sp.maxMileage) params.set("maxMileage", sp.maxMileage);
                if (sp.minYear) params.set("minYear", sp.minYear);
                if (sp.maxYear) params.set("maxYear", sp.maxYear);
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
