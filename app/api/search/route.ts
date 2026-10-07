import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import {
  expireStaleLiveListings,
} from "@/lib/listings/expiry";
import {
  numericAttributeListingIdQuery,
  parseNumericAttributeBound,
} from "@/lib/listings/numeric-attribute-search";
import {
  combineMarketplaceListingWhere,
  marketplaceListingWhereWithSettings,
  marketplaceListingBadge,
} from "@/lib/listings/marketplace";
import { listingPreviewCardProps } from "@/lib/preview-packs/review";
import { findListingsInAttributeOrder } from "@/lib/search/attribute-sort";
import { normalizeNumericFilterUnits } from "@/lib/search/numeric-filter-units";
import {
  getSearchOrderBy,
  isAttributeSearchSort,
  parseSearchSort,
} from "@/lib/search/search-order";
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

interface NumericRangeFilter {
  slug: string;
  min?: number;
  max?: number;
}

export async function GET(request: NextRequest) {
  await expireStaleLiveListings();
  const currentUser = await getCurrentUser();
  const sp = request.nextUrl.searchParams;
  const numericUnits = normalizeNumericFilterUnits({
    numericFilterUnits: sp.get("numericFilterUnits") ?? undefined,
    minEngineSize: sp.get("minEngineSize") ?? undefined,
    maxEngineSize: sp.get("maxEngineSize") ?? undefined,
    minChargingTime: sp.get("minChargingTime") ?? undefined,
    maxChargingTime: sp.get("maxChargingTime") ?? undefined,
  });
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
    {
      slug: "engine-size",
      min: parseNumericAttributeBound(numericUnits.minEngineSize, "engine-size"),
      max: parseNumericAttributeBound(numericUnits.maxEngineSize, "engine-size"),
    },
    {
      slug: "engine-power",
      min: parseNumericAttributeBound(sp.get("minEnginePower"), "engine-power"),
      max: parseNumericAttributeBound(sp.get("maxEnginePower"), "engine-power"),
    },
    ...(canApplyBatteryFilters
      ? [
          {
            slug: "battery-range",
            min: parseNumericAttributeBound(sp.get("minBatteryRange"), "battery-range"),
            max: parseNumericAttributeBound(sp.get("maxBatteryRange"), "battery-range"),
          },
          {
            slug: "charging-time",
            min: parseNumericAttributeBound(numericUnits.minChargingTime, "charging-time"),
            max: parseNumericAttributeBound(numericUnits.maxChargingTime, "charging-time"),
          },
        ]
      : []),
    {
      slug: "acceleration",
      min: parseNumericAttributeBound(sp.get("minAcceleration"), "acceleration"),
      max: parseNumericAttributeBound(sp.get("maxAcceleration"), "acceleration"),
    },
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
    {
      slug: "co2-emissions",
      min: parseNumericAttributeBound(sp.get("minCo2"), "co2-emissions"),
      max: parseNumericAttributeBound(sp.get("maxCo2"), "co2-emissions"),
    },
    {
      slug: "tax-per-year",
      min: parseOptionalBoundedInteger(sp.get("minTax"), TAX_MIN, TAX_MAX),
      max: parseOptionalBoundedInteger(sp.get("maxTax"), TAX_MIN, TAX_MAX),
    },
    {
      slug: "insurance-group",
      min: parseNumericAttributeBound(sp.get("minInsuranceGroup"), "insurance-group"),
      max: parseNumericAttributeBound(sp.get("maxInsuranceGroup"), "insurance-group"),
    },
    {
      slug: "boot-space",
      min: parseNumericAttributeBound(sp.get("minBootSpace"), "boot-space"),
      max: parseNumericAttributeBound(sp.get("maxBootSpace"), "boot-space"),
    },
    {
      slug: "doors",
      min: parseNumericAttributeBound(sp.get("doors"), "doors"),
      max: parseNumericAttributeBound(sp.get("doors"), "doors"),
    },
    {
      slug: "seats",
      min: parseNumericAttributeBound(sp.get("seats"), "seats"),
      max: parseNumericAttributeBound(sp.get("seats"), "seats"),
    },
  ].filter((filter) => filter.min !== undefined || filter.max !== undefined);

  let listingIdsFromAttributes: string[] | null = null;
  if (numericRangeFilters.length > 0) {
    const result = await db.$queryRaw<{ id: string }[]>(
      numericAttributeListingIdQuery(numericRangeFilters),
    );
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
    ...(listingIdsFromAttributes !== null ? { id: { in: listingIdsFromAttributes } } : {}),
    ...(sp.get("category") ? { category: { slug: sp.get("category")! } } : {}),
    ...(sp.get("featured") === "true" ? { featured: true } : {}),
    ...(sp.get("region") ? { region: { slug: sp.get("region")! } } : {}),
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
    },
  });

  const listingInclude = {
    images: { take: 1, orderBy: { order: "asc" as const }, select: listingPhotoSelect },
    category: true,
    region: true,
    attributeValues: {
      where: { attributeDefinition: { slug: "write-off-category" } },
      select: {
        value: true,
        attributeDefinition: { select: { slug: true } },
      },
    },
  };
  const skip = (page - 1) * pageSize;
  const listingsQuery = isAttributeSearchSort(sort)
    ? findListingsInAttributeOrder({
        where,
        sort,
        skip,
        take: pageSize,
        load: (ids) =>
          db.listing.findMany({
            where: { id: { in: ids } },
            include: listingInclude,
          }),
      })
    : db.listing.findMany({
        where,
        orderBy: getSearchOrderBy(sort),
        skip,
        take: pageSize,
        include: listingInclude,
      });

  const [listings, total] = await Promise.all([
    listingsQuery,
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
    })),
  });
}
