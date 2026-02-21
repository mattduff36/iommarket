export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SearchControls } from "@/components/marketplace/search/search-controls";
import { ListingResultsClient } from "@/components/marketplace/search/listing-results-client";
import { SaveSearchButton } from "@/components/marketplace/save-search-button";
import { getMakesWithDb } from "@/lib/constants/vehicle-makes";
import { type SearchParams } from "@/lib/search/search-url";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const canonicalParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (!value) continue;
    if (key === "page" && value === "1") continue;
    canonicalParams.set(key, value);
  }
  const canonicalPath = canonicalParams.toString()
    ? `/search?${canonicalParams.toString()}`
    : "/search";
  return {
    title: sp.q ? `Search: ${sp.q}` : "Search",
    description: "Search vehicles on itrader.im. Cars, vans, motorbikes across the Isle of Man.",
    alternates: {
      canonical: `${appUrl}${canonicalPath}`,
    },
  };
}

function safeInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

interface NumericRangeFilter {
  slug: string;
  min?: number;
  max?: number;
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const currentUser = await getCurrentUser();
  const query = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;

  const minPricePence = sp.minPrice ? parseInt(sp.minPrice, 10) * 100 : undefined;
  const maxPricePence = sp.maxPrice ? parseInt(sp.maxPrice, 10) * 100 : undefined;

  const numericRangeFilters: NumericRangeFilter[] = [
    { slug: "mileage", min: safeInt(sp.minMileage), max: safeInt(sp.maxMileage) },
    { slug: "year", min: safeInt(sp.minYear), max: safeInt(sp.maxYear) },
    { slug: "engine-size", min: safeInt(sp.minEngineSize), max: safeInt(sp.maxEngineSize) },
    { slug: "engine-power", min: safeInt(sp.minEnginePower), max: safeInt(sp.maxEnginePower) },
    { slug: "battery-range", min: safeInt(sp.minBatteryRange), max: safeInt(sp.maxBatteryRange) },
    { slug: "charging-time", min: safeInt(sp.minChargingTime), max: safeInt(sp.maxChargingTime) },
    { slug: "acceleration", min: safeInt(sp.minAcceleration), max: safeInt(sp.maxAcceleration) },
    { slug: "fuel-consumption", min: safeInt(sp.minFuelConsumption), max: safeInt(sp.maxFuelConsumption) },
    { slug: "co2-emissions", min: safeInt(sp.minCo2), max: safeInt(sp.maxCo2) },
    { slug: "tax-per-year", min: safeInt(sp.minTax), max: safeInt(sp.maxTax) },
    { slug: "insurance-group", min: safeInt(sp.minInsuranceGroup), max: safeInt(sp.maxInsuranceGroup) },
    { slug: "boot-space", min: safeInt(sp.minBootSpace), max: safeInt(sp.maxBootSpace) },
    { slug: "doors", min: safeInt(sp.doors), max: safeInt(sp.doors) },
    { slug: "seats", min: safeInt(sp.seats), max: safeInt(sp.seats) },
  ].filter((f) => f.min !== undefined || f.max !== undefined);

  let listingIdsFromAttributes: string[] | null = null;
  if (numericRangeFilters.length > 0) {
    const { Prisma } = await import("@prisma/client");
    const conditions = numericRangeFilters.map((f) =>
      Prisma.sql`EXISTS (
        SELECT 1 FROM listing_attribute_values lav
        INNER JOIN attribute_definitions ad ON ad.id = lav.attribute_definition_id
        WHERE lav.listing_id = l.id AND ad.slug = ${f.slug}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) >= ${f.min ?? 0}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) <= ${f.max ?? 999999999}
      )`
    );

    let combined = conditions[0];
    for (let i = 1; i < conditions.length; i++) {
      combined = Prisma.sql`${combined} AND ${conditions[i]}`;
    }

    const result = await db.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM listings l
      WHERE l.status = 'LIVE'
      AND ${combined}
    `;
    listingIdsFromAttributes = result.map((r) => r.id);
  }

  const exactAttrFilters: Array<{ slug: string; value: string }> = [];
  if (sp.fuelType) exactAttrFilters.push({ slug: "fuel-type", value: sp.fuelType });
  if (sp.transmission) exactAttrFilters.push({ slug: "transmission", value: sp.transmission });
  if (sp.bodyType) exactAttrFilters.push({ slug: "body-type", value: sp.bodyType });
  if (sp.colour) exactAttrFilters.push({ slug: "colour", value: sp.colour });
  if (sp.driveType) exactAttrFilters.push({ slug: "drive-type", value: sp.driveType });
  if (sp.location) exactAttrFilters.push({ slug: "location", value: sp.location });

  const attrAndClauses = [
    ...(sp.make
      ? [{
          attributeValues: {
            some: {
              attributeDefinition: { slug: "make" },
              value: { equals: sp.make, mode: "insensitive" as const },
            },
          },
        }]
      : []),
    ...(sp.model
      ? [{
          attributeValues: {
            some: {
              attributeDefinition: { slug: "model" },
              value: { equals: sp.model, mode: "insensitive" as const },
            },
          },
        }]
      : []),
    ...exactAttrFilters.map((f) => ({
      attributeValues: {
        some: {
          attributeDefinition: { slug: f.slug },
          value: { equals: f.value, mode: "insensitive" as const },
        },
      },
    })),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
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
    ...(sp.sellerType === "private" ? { dealerId: null } : {}),
    ...(sp.sellerType === "dealer" ? { dealerId: { not: null } } : {}),
    ...(attrAndClauses.length > 0 ? { AND: attrAndClauses } : {}),
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
  for (const row of makeRows) {
    const mdl = modelByListingId.get(row.listingId);
    if (mdl) {
      if (!modelsByMake[row.value]) modelsByMake[row.value] = [];
      if (!modelsByMake[row.value].includes(mdl)) modelsByMake[row.value].push(mdl);
    }
  }
  Object.keys(modelsByMake).forEach((m) => modelsByMake[m].sort());

  const dbMakes = [...new Set(makeRows.map((r) => r.value))];
  const makes = getMakesWithDb(dbMakes);

  const currentParams: SearchParams = {
    q: sp.q, category: sp.category, region: sp.region,
    make: sp.make, model: sp.model,
    minPrice: sp.minPrice, maxPrice: sp.maxPrice,
    minMileage: sp.minMileage, maxMileage: sp.maxMileage,
    minYear: sp.minYear, maxYear: sp.maxYear,
    bodyType: sp.bodyType, colour: sp.colour,
    doors: sp.doors, seats: sp.seats,
    fuelType: sp.fuelType, transmission: sp.transmission,
    driveType: sp.driveType, sellerType: sp.sellerType, location: sp.location,
    minEngineSize: sp.minEngineSize, maxEngineSize: sp.maxEngineSize,
    minEnginePower: sp.minEnginePower, maxEnginePower: sp.maxEnginePower,
    minBatteryRange: sp.minBatteryRange, maxBatteryRange: sp.maxBatteryRange,
    minChargingTime: sp.minChargingTime, maxChargingTime: sp.maxChargingTime,
    minAcceleration: sp.minAcceleration, maxAcceleration: sp.maxAcceleration,
    minFuelConsumption: sp.minFuelConsumption, maxFuelConsumption: sp.maxFuelConsumption,
    minCo2: sp.minCo2, maxCo2: sp.maxCo2,
    minTax: sp.minTax, maxTax: sp.maxTax,
    minInsuranceGroup: sp.minInsuranceGroup, maxInsuranceGroup: sp.maxInsuranceGroup,
    minBootSpace: sp.minBootSpace, maxBootSpace: sp.maxBootSpace,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
      <div className="mb-6 sm:mb-10">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          {query ? `Results for "${query}"` : "All Listings"}
        </h1>
      </div>
      <div className="sticky top-16 z-20 bg-canvas/95 backdrop-blur-sm py-2 mb-5 border-b border-border">
        <SearchControls
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
          initial={currentParams}
          mode="instant"
          showAdvancedInline
          className="mb-0"
        />
      </div>

      <div className="mb-4 flex justify-end">
        {currentUser ? (
          <SaveSearchButton
            queryParams={Object.fromEntries(
              Object.entries(currentParams).filter(([, value]) => Boolean(value))
            ) as Record<string, string>}
          />
        ) : null}
      </div>

      {listings.length > 0 ? (
        <ListingResultsClient
          initialListings={listings.map((listing) => ({
            id: listing.id,
            title: listing.title,
            price: listing.price,
            featured: listing.featured,
            imageSrc: listing.images[0]?.url,
            categoryName: listing.category.name,
            regionName: listing.region.name,
          }))}
          total={total}
          pageSize={pageSize}
          queryParams={currentParams}
        />
      ) : (
        <p className="text-center py-16 text-text-secondary">
          No listings found. Try adjusting your search.
        </p>
      )}
    </div>
  );
}
