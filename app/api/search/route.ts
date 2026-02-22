import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
  const sp = request.nextUrl.searchParams;
  const query = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10));
  const pageSize = 12;

  const includeSold = sp.get("includeSold") === "true";
  const minPricePence = sp.get("minPrice")
    ? Number.parseInt(sp.get("minPrice") ?? "0", 10) * 100
    : undefined;
  const maxPricePence = sp.get("maxPrice")
    ? Number.parseInt(sp.get("maxPrice") ?? "0", 10) * 100
    : undefined;

  const numericRangeFilters: NumericRangeFilter[] = [
    { slug: "mileage", min: safeInt(sp.get("minMileage")), max: safeInt(sp.get("maxMileage")) },
    { slug: "year", min: safeInt(sp.get("minYear")), max: safeInt(sp.get("maxYear")) },
    { slug: "engine-size", min: safeInt(sp.get("minEngineSize")), max: safeInt(sp.get("maxEngineSize")) },
    { slug: "engine-power", min: safeInt(sp.get("minEnginePower")), max: safeInt(sp.get("maxEnginePower")) },
    { slug: "battery-range", min: safeInt(sp.get("minBatteryRange")), max: safeInt(sp.get("maxBatteryRange")) },
    { slug: "charging-time", min: safeInt(sp.get("minChargingTime")), max: safeInt(sp.get("maxChargingTime")) },
    { slug: "acceleration", min: safeInt(sp.get("minAcceleration")), max: safeInt(sp.get("maxAcceleration")) },
    { slug: "fuel-consumption", min: safeInt(sp.get("minFuelConsumption")), max: safeInt(sp.get("maxFuelConsumption")) },
    { slug: "co2-emissions", min: safeInt(sp.get("minCo2")), max: safeInt(sp.get("maxCo2")) },
    { slug: "tax-per-year", min: safeInt(sp.get("minTax")), max: safeInt(sp.get("maxTax")) },
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
      WHERE (l.status = 'LIVE' OR (${includeSold} AND l.status = 'SOLD'))
      AND ${combined}
    `;
    listingIdsFromAttributes = result.map((row) => row.id);
  }

  const exactAttrFilters: Array<{ slug: string; value: string | null }> = [
    { slug: "fuel-type", value: sp.get("fuelType") },
    { slug: "transmission", value: sp.get("transmission") },
    { slug: "body-type", value: sp.get("bodyType") },
    { slug: "colour", value: sp.get("colour") },
    { slug: "drive-type", value: sp.get("driveType") },
    { slug: "location", value: sp.get("location") },
  ].filter((entry) => Boolean(entry.value));

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
          value: { equals: entry.value ?? "", mode: "insensitive" as const },
        },
      },
    })),
  ];

  const statusFilter = includeSold
    ? { status: { in: ["LIVE", "SOLD"] as const } }
    : { status: "LIVE" as const };

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
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    listings: listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      featured: listing.featured,
      sold: listing.status === "SOLD",
      imageSrc: listing.images[0]?.url,
      categoryName: listing.category.name,
      regionName: listing.region.name,
    })),
  });
}
