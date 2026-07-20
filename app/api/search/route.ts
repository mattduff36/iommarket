import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  expireStaleLiveListings,
  liveOrSoldListingWhere,
} from "@/lib/listings/expiry";
import { getSearchOrderBy, parseSearchSort } from "@/lib/search/search-order";
import {
  getFuelTypeFilterValues,
  isEvCompatibleFuelType,
  parseFuelTypeFilter,
} from "@/lib/constants/fuel-types";
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

function safeInt(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

interface NumericRangeFilter {
  slug: string;
  min?: number;
  max?: number;
}

export async function GET(request: NextRequest) {
  await expireStaleLiveListings();
  const currentUser = await getCurrentUser();
  const sp = request.nextUrl.searchParams;
  const query = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10));
  const pageSize = 12;
  const sort = parseSearchSort(sp.get("sort"));

  const includeSold = sp.get("includeSold") === "true";
  const now = new Date();
  const currentYear = getCurrentYear();
  const minPrice = parseOptionalBoundedInteger(sp.get("minPrice"), PRICE_MIN, PRICE_MAX);
  const maxPrice = parseOptionalBoundedInteger(sp.get("maxPrice"), PRICE_MIN, PRICE_MAX);
  const minPricePence = minPrice !== undefined ? minPrice * 100 : undefined;
  const maxPricePence = maxPrice !== undefined ? maxPrice * 100 : undefined;
  const fuelTypeFilter = parseFuelTypeFilter(sp.get("fuelType"));
  const canApplyBatteryFilters = !fuelTypeFilter || isEvCompatibleFuelType(fuelTypeFilter);

  const numericRangeFilters: NumericRangeFilter[] = [
    {
      slug: "mileage",
      min: parseOptionalBoundedInteger(sp.get("minMileage"), MILEAGE_MIN, MILEAGE_MAX),
      max: parseOptionalBoundedInteger(sp.get("maxMileage"), MILEAGE_MIN, MILEAGE_MAX),
    },
    {
      slug: "year",
      min: parseOptionalBoundedInteger(sp.get("minYear"), YEAR_MIN, currentYear),
      max: parseOptionalBoundedInteger(sp.get("maxYear"), YEAR_MIN, currentYear),
    },
    { slug: "engine-size", min: safeInt(sp.get("minEngineSize")), max: safeInt(sp.get("maxEngineSize")) },
    { slug: "engine-power", min: safeInt(sp.get("minEnginePower")), max: safeInt(sp.get("maxEnginePower")) },
    ...(canApplyBatteryFilters
      ? [
          { slug: "battery-range", min: safeInt(sp.get("minBatteryRange")), max: safeInt(sp.get("maxBatteryRange")) },
          { slug: "charging-time", min: safeInt(sp.get("minChargingTime")), max: safeInt(sp.get("maxChargingTime")) },
        ]
      : []),
    { slug: "acceleration", min: safeInt(sp.get("minAcceleration")), max: safeInt(sp.get("maxAcceleration")) },
    {
      slug: "fuel-consumption",
      min: parseOptionalBoundedInteger(
        sp.get("minFuelConsumption"),
        FUEL_CONSUMPTION_MIN,
        FUEL_CONSUMPTION_MAX,
      ),
      max: parseOptionalBoundedInteger(
        sp.get("maxFuelConsumption"),
        FUEL_CONSUMPTION_MIN,
        FUEL_CONSUMPTION_MAX,
      ),
    },
    { slug: "co2-emissions", min: safeInt(sp.get("minCo2")), max: safeInt(sp.get("maxCo2")) },
    {
      slug: "tax-per-year",
      min: parseOptionalBoundedInteger(sp.get("minTax"), TAX_MIN, TAX_MAX),
      max: parseOptionalBoundedInteger(sp.get("maxTax"), TAX_MIN, TAX_MAX),
    },
    { slug: "insurance-group", min: safeInt(sp.get("minInsuranceGroup")), max: safeInt(sp.get("maxInsuranceGroup")) },
    { slug: "boot-space", min: safeInt(sp.get("minBootSpace")), max: safeInt(sp.get("maxBootSpace")) },
    { slug: "doors", min: safeInt(sp.get("doors")), max: safeInt(sp.get("doors")) },
    { slug: "seats", min: safeInt(sp.get("seats")), max: safeInt(sp.get("seats")) },
  ].filter((filter) => filter.min !== undefined || filter.max !== undefined);

  let listingIdsFromAttributes: string[] | null = null;
  if (numericRangeFilters.length > 0) {
    const { Prisma } = await import("@prisma/client");
    const conditions = numericRangeFilters.map((filter) =>
      Prisma.sql`EXISTS (
        SELECT 1 FROM listing_attribute_values lav
        INNER JOIN attribute_definitions ad ON ad.id = lav.attribute_definition_id
        WHERE lav.listing_id = l.id AND ad.slug = ${filter.slug}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) >= ${filter.min ?? 0}
        AND CAST(NULLIF(TRIM(lav.value), '') AS INT) <= ${filter.max ?? 999999999}
      )`
    );

    let combined = conditions[0];
    for (let i = 1; i < conditions.length; i++) {
      combined = Prisma.sql`${combined} AND ${conditions[i]}`;
    }

    const result = await db.$queryRaw<{ id: string }[]>`
      SELECT l.id FROM listings l
      WHERE (
        (l.status = 'LIVE' AND (l.expires_at IS NULL OR l.expires_at > NOW()))
        OR (${includeSold} AND l.status = 'SOLD')
      )
      AND ${combined}
    `;
    listingIdsFromAttributes = result.map((row) => row.id);
  }

  const exactAttrFilters: Array<{ slug: string; values: readonly string[] }> = [
    ...(fuelTypeFilter
      ? [{
          slug: "fuel-type",
          values: getFuelTypeFilterValues(fuelTypeFilter),
        }]
      : []),
    ...[
      { slug: "transmission", value: sp.get("transmission") },
      { slug: "body-type", value: sp.get("bodyType") },
      { slug: "colour", value: sp.get("colour") },
      { slug: "drive-type", value: sp.get("driveType") },
      { slug: "location", value: sp.get("location") },
    ]
      .filter((entry): entry is { slug: string; value: string } => Boolean(entry.value))
      .map((entry) => ({ slug: entry.slug, values: [entry.value] })),
  ];

  const make = sp.get("make");
  const model = sp.get("model");

  const attrAndClauses = [
    ...(make
      ? [{
          attributeValues: {
            some: {
              attributeDefinition: { slug: "make" },
              value: { equals: make, mode: "insensitive" as const },
            },
          },
        }]
      : []),
    ...(model
      ? [{
          attributeValues: {
            some: {
              attributeDefinition: { slug: "model" },
              value: { equals: model, mode: "insensitive" as const },
            },
          },
        }]
      : []),
    ...exactAttrFilters.map((entry) => ({
      attributeValues: {
        some: {
          attributeDefinition: { slug: entry.slug },
          value:
            entry.values.length === 1
              ? { equals: entry.values[0], mode: "insensitive" as const }
              : { in: [...entry.values] },
        },
      },
    })),
  ];

  const statusFilter = liveOrSoldListingWhere(includeSold, now);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    ...statusFilter,
    ...(listingIdsFromAttributes !== null ? { id: { in: listingIdsFromAttributes } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { description: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(sp.get("category") ? { category: { slug: sp.get("category") } } : {}),
    ...(sp.get("featured") === "true" ? { featured: true } : {}),
    ...(sp.get("region") ? { region: { slug: sp.get("region") } } : {}),
    ...(minPricePence !== undefined || maxPricePence !== undefined
      ? {
          price: {
            ...(minPricePence !== undefined ? { gte: minPricePence } : {}),
            ...(maxPricePence !== undefined ? { lte: maxPricePence } : {}),
          },
        }
      : {}),
    ...(sp.get("sellerType") === "private" ? { dealerId: null } : {}),
    ...(sp.get("sellerType") === "dealer" ? { dealerId: { not: null } } : {}),
    ...(attrAndClauses.length > 0 ? { AND: attrAndClauses } : {}),
  };

  const [listings, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: getSearchOrderBy(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        images: { take: 1, orderBy: { order: "asc" } },
        category: true,
        region: true,
      },
    }),
    db.listing.count({ where }),
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

  return NextResponse.json({
    total,
    page,
    pageSize,
    listings: listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      featured: listing.featured,
      isFavourite: favouriteListingIds.has(listing.id),
      sold: listing.status === "SOLD",
      imageSrc: listing.images[0]?.url,
      categoryName: listing.category.name,
      regionName: listing.region.name,
    })),
  });
}
