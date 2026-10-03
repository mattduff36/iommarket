export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SearchControls } from "@/components/marketplace/search/search-controls";
import { ListingResultsClient } from "@/components/marketplace/search/listing-results-client";
import { SaveSearchButton } from "@/components/marketplace/save-search-button";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import {
  getSearchSeoState,
  normalizeSearchParams,
  type SearchParams,
} from "@/lib/search/search-url";
import { categoryLandingCopy } from "@/lib/seo/category-copy";
import { publicPageMetadata } from "@/lib/seo/page-metadata";
import { buildCategorySearchPath } from "@/lib/navigation-paths";
import Link from "next/link";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { getSearchOrderBy, parseSearchSort } from "@/lib/search/search-order";
import {
  getFuelTypeFilterValues,
  isEvCompatibleFuelType,
  parseFuelTypeFilter,
} from "@/lib/constants/fuel-types";
import {
  expireStaleLiveListings,
} from "@/lib/listings/expiry";
import {
  combineMarketplaceListingWhere,
  marketplaceListingWhereWithSettings,
  marketplaceListingBadge,
} from "@/lib/listings/marketplace";
import { listingPreviewCardProps } from "@/lib/preview-packs/review";
import {
  FUEL_CONSUMPTION_MAX,
  FUEL_CONSUMPTION_MIN,
  MILEAGE_MAX,
  MILEAGE_MIN,
  PRICE_MAX,
  PRICE_MIN,
  TAX_MAX,
  TAX_MIN,
  YEAR_MIN,
  getCurrentYear,
  parseOptionalBoundedInteger,
} from "@/lib/constants/search-filters";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = normalizeSearchParams(await searchParams);
  const activeCategory = sp.category
    ? await db.category.findFirst({
        where: { slug: sp.category, active: true },
        select: { slug: true, name: true },
      })
    : null;
  const seo = getSearchSeoState(sp, activeCategory?.slug);
  const categoryCopy = activeCategory
    ? categoryLandingCopy(activeCategory.slug, activeCategory.name)
    : null;
  return publicPageMetadata({
    title: sp.q ? `Search: ${sp.q}` : categoryCopy?.title ?? "Search",
    description:
      categoryCopy?.description ??
      "Search cars, vans, motorbikes and motorhomes on iTrader.im, including vehicles located in the Isle of Man and the United Kingdom.",
    path: seo.canonicalPath,
    index: seo.indexable,
  });
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
  await expireStaleLiveListings();
  const sp = normalizeSearchParams(await searchParams);
  const currentUser = await getCurrentUser();
  const query = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;
  const sort = parseSearchSort(sp.sort);
  const fuelTypeFilter = parseFuelTypeFilter(sp.fuelType);

  const includeSold = sp.includeSold === "true";
  const now = new Date();
  const liveVisibilityWhere = await marketplaceListingWhereWithSettings({
    viewer: currentUser,
    now,
    includeDisabledPreviewPacks: true,
  });
  const currentYear = getCurrentYear();
  const minPrice = parseOptionalBoundedInteger(sp.minPrice, PRICE_MIN, PRICE_MAX);
  const maxPrice = parseOptionalBoundedInteger(sp.maxPrice, PRICE_MIN, PRICE_MAX);
  const minPricePence = minPrice !== undefined ? minPrice * 100 : undefined;
  const maxPricePence = maxPrice !== undefined ? maxPrice * 100 : undefined;
  const canApplyBatteryFilters = !fuelTypeFilter || isEvCompatibleFuelType(fuelTypeFilter);

  const numericRangeFilters: NumericRangeFilter[] = [
    {
      slug: "mileage",
      min: parseOptionalBoundedInteger(sp.minMileage, MILEAGE_MIN, MILEAGE_MAX),
      max: parseOptionalBoundedInteger(sp.maxMileage, MILEAGE_MIN, MILEAGE_MAX),
    },
    {
      slug: "year",
      min: parseOptionalBoundedInteger(sp.minYear, YEAR_MIN, currentYear),
      max: parseOptionalBoundedInteger(sp.maxYear, YEAR_MIN, currentYear),
    },
    { slug: "engine-size", min: safeInt(sp.minEngineSize), max: safeInt(sp.maxEngineSize) },
    { slug: "engine-power", min: safeInt(sp.minEnginePower), max: safeInt(sp.maxEnginePower) },
    ...(canApplyBatteryFilters
      ? [
          { slug: "battery-range", min: safeInt(sp.minBatteryRange), max: safeInt(sp.maxBatteryRange) },
          { slug: "charging-time", min: safeInt(sp.minChargingTime), max: safeInt(sp.maxChargingTime) },
        ]
      : []),
    { slug: "acceleration", min: safeInt(sp.minAcceleration), max: safeInt(sp.maxAcceleration) },
    {
      slug: "fuel-consumption",
      min: parseOptionalBoundedInteger(
        sp.minFuelConsumption,
        FUEL_CONSUMPTION_MIN,
        FUEL_CONSUMPTION_MAX,
      ),
      max: parseOptionalBoundedInteger(
        sp.maxFuelConsumption,
        FUEL_CONSUMPTION_MIN,
        FUEL_CONSUMPTION_MAX,
      ),
    },
    { slug: "co2-emissions", min: safeInt(sp.minCo2), max: safeInt(sp.maxCo2) },
    {
      slug: "tax-per-year",
      min: parseOptionalBoundedInteger(sp.minTax, TAX_MIN, TAX_MAX),
      max: parseOptionalBoundedInteger(sp.maxTax, TAX_MIN, TAX_MAX),
    },
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
      WHERE ${combined}
    `;
    listingIdsFromAttributes = result.map((r) => r.id);
  }

  const exactAttrFilters: Array<{ slug: string; values: readonly string[] }> = [];
  if (fuelTypeFilter) {
    exactAttrFilters.push({
      slug: "fuel-type",
      values: getFuelTypeFilterValues(fuelTypeFilter),
    });
  }
  if (sp.transmission) exactAttrFilters.push({ slug: "transmission", values: [sp.transmission] });
  if (sp.bodyType) exactAttrFilters.push({ slug: "body-type", values: [sp.bodyType] });
  if (sp.colour) exactAttrFilters.push({ slug: "colour", values: [sp.colour] });
  if (sp.driveType) exactAttrFilters.push({ slug: "drive-type", values: [sp.driveType] });
  if (sp.location) exactAttrFilters.push({ slug: "location", values: [sp.location] });

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
          value:
            f.values.length === 1
              ? { equals: f.values[0], mode: "insensitive" as const }
              : { in: [...f.values] },
        },
      },
    })),
  ];

  const statusFilter = await marketplaceListingWhereWithSettings({
    viewer: currentUser,
    includeSold,
    now,
    includeDisabledPreviewPacks: true,
  });

  const where = combineMarketplaceListingWhere({
    visibility: statusFilter,
    clauses: [
      ...(query
        ? [{
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { description: { contains: query, mode: "insensitive" as const } },
            ],
          }]
        : []),
      ...attrAndClauses,
    ],
    filters: {
    ...(listingIdsFromAttributes !== null
      ? { id: { in: listingIdsFromAttributes } }
      : {}),
    ...(sp.category ? { category: { slug: sp.category } } : {}),
    ...(sp.featured === "true" ? { featured: true } : {}),
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
    },
  });

  const [
    listings,
    total,
    categories,
    regions,
    makeDefs,
    modelDefs,
    selectedCategory,
  ] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: getSearchOrderBy(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        images: { take: 1, orderBy: { order: "asc" }, select: listingPhotoSelect },
        category: true,
        region: true,
        attributeValues: {
          where: { attributeDefinition: { slug: "write-off-category" } },
          select: {
            value: true,
            attributeDefinition: { select: { slug: true } },
          },
        },
      },
    }),
    db.listing.count({ where }),
    db.category.findMany({
      where: { active: true, parentId: null },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { listings: { where: liveVisibilityWhere } } },
      },
    }),
    db.region.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.attributeDefinition.findMany({
      where: { slug: "make" },
      select: { id: true },
    }),
    db.attributeDefinition.findMany({
      where: { slug: "model" },
      select: { id: true },
    }),
    sp.category
      ? db.category.findFirst({
          where: { slug: sp.category, active: true },
          select: { name: true, slug: true },
        })
      : Promise.resolve(null),
  ]);
  const favouriteListingIds = currentUser
    ? new Set(
        (
          await db.favourite.findMany({
            where: {
              userId: currentUser.id,
              listingId: { in: listings.map((listing) => listing.id) },
            },
            select: { listingId: true },
          })
        ).map((favourite) => favourite.listingId)
      )
    : new Set<string>();

  const makeIds = makeDefs.map((d) => d.id);
  const modelIds = modelDefs.map((d) => d.id);
  const [makeRows, modelRows] = await Promise.all([
    makeIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: {
            attributeDefinitionId: { in: makeIds },
            listing: liveVisibilityWhere,
          },
          select: { listingId: true, value: true },
        })
      : Promise.resolve([]),
    modelIds.length > 0
      ? db.listingAttributeValue.findMany({
          where: {
            attributeDefinitionId: { in: modelIds },
            listing: liveVisibilityWhere,
          },
          select: { listingId: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const modelByListingId = new Map(modelRows.map((r) => [r.listingId, r.value]));
  const modelCountsByMake: Record<string, Record<string, number>> = {};
  for (const row of makeRows) {
    const mdl = modelByListingId.get(row.listingId);
    if (mdl) {
      if (!modelCountsByMake[row.value]) modelCountsByMake[row.value] = {};
      modelCountsByMake[row.value][mdl] = (modelCountsByMake[row.value][mdl] ?? 0) + 1;
    }
  }
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
  const searchSeo = getSearchSeoState(sp, selectedCategory?.slug);
  const canonicalPath = searchSeo.canonicalPath;
  const categoryCopy = selectedCategory
    ? categoryLandingCopy(selectedCategory.slug, selectedCategory.name)
    : null;
  const categoryLanding = Boolean(categoryCopy && !query && searchSeo.indexable);
  const resultHeading = query ? `Results for “${query}”` : categoryCopy?.heading ?? "All Listings";
  const breadcrumbLabel = query
    ? resultHeading
    : selectedCategory?.name ??
      (sp.sellerType === "dealer" ? "Dealer listings" : "All listings");

  const currentParams: SearchParams = {
    q: sp.q, category: sp.category, region: sp.region,
    make: sp.make, model: sp.model,
    minPrice: sp.minPrice, maxPrice: sp.maxPrice,
    minMileage: sp.minMileage, maxMileage: sp.maxMileage,
    minYear: sp.minYear, maxYear: sp.maxYear,
    bodyType: sp.bodyType, colour: sp.colour,
    doors: sp.doors, seats: sp.seats,
    fuelType: fuelTypeFilter, transmission: sp.transmission,
    driveType: sp.driveType, sellerType: sp.sellerType, location: sp.location,
    includeSold: sp.includeSold,
    sort: sp.sort, featured: sp.featured,
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
      <Breadcrumbs
        items={[
          { label: "Buy", href: "/categories" },
          { label: breadcrumbLabel, href: canonicalPath },
        ]}
      />
      <div className="mb-6 sm:mb-10">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          {resultHeading}
        </h1>
        {categoryLanding && categoryCopy ? (
          <div className="mt-3 max-w-3xl space-y-3 text-sm leading-relaxed text-text-secondary">
            <p>{categoryCopy.intro}</p>
            <p>
              <Link href="/sell-on-the-isle-of-man" className="text-text-trust hover:underline">
                Sell a vehicle on the Isle of Man
              </Link>
              {" · "}
              <Link href="/dealer-advertising" className="text-text-trust hover:underline">
                Advertise as a dealer
              </Link>
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {categories
                .filter((category) => category.slug !== selectedCategory?.slug)
                .map((category) => (
                  <li key={category.slug}>
                    <Link href={buildCategorySearchPath(category.slug)} className="text-text-trust hover:underline">
                      {category.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="sticky top-16 z-20 bg-canvas/95 backdrop-blur-sm py-2 mb-5 border-b border-border">
        <SearchControls
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
            isFavourite: favouriteListingIds.has(listing.id),
            sold: listing.status === "SOLD",
            photo: toListingPhotoSource(listing.images[0]),
            categoryName: listing.category.name,
            regionName: listing.region.name,
            writeOffCategory: listing.attributeValues[0]?.value ?? null,
            badge: marketplaceListingBadge({
              status: listing.status,
              featured: listing.featured,
            }),
            showFavourite: listing.status !== "ADMIN_PREVIEW",
            ...listingPreviewCardProps(
              listing,
              Boolean(toListingPhotoSource(listing.images[0])),
            ),
          }))}
          total={total}
          pageSize={pageSize}
          queryParams={currentParams}
          enableFavourites={Boolean(currentUser)}
        />
      ) : (
        <p className="text-center py-16 text-text-secondary">
          No listings found. Try adjusting your search.
        </p>
      )}
    </div>
  );
}
