import { db } from "@/lib/db";
import { getKnownVehicleModelsByMake } from "@/lib/constants/vehicle-models";

export async function getSellFormData() {
  const [categories, regions, vehicleModelRows] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.region.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    db.listingAttributeValue.findMany({
      where: {
        attributeDefinition: {
          slug: { in: ["make", "model"] },
        },
      },
      select: {
        listingId: true,
        value: true,
        attributeDefinition: {
          select: { slug: true },
        },
      },
    }),
  ]);

  const makeByListingId = new Map<string, string>();
  const modelsByListingId = new Map<string, string[]>();
  for (const row of vehicleModelRows) {
    if (row.attributeDefinition.slug === "make") {
      makeByListingId.set(row.listingId, row.value);
      continue;
    }
    const models = modelsByListingId.get(row.listingId) ?? [];
    models.push(row.value);
    modelsByListingId.set(row.listingId, models);
  }

  const marketplaceModelsByMake: Record<string, string[]> = {};
  for (const [listingId, make] of makeByListingId) {
    const models = modelsByListingId.get(listingId);
    if (!models) continue;
    marketplaceModelsByMake[make] = [
      ...(marketplaceModelsByMake[make] ?? []),
      ...models,
    ];
  }

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      attributes: category.attributeDefinitions.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        slug: attribute.slug,
        dataType: attribute.dataType,
        required: attribute.required,
        options: attribute.options,
      })),
    })),
    regions: regions.map((region) => ({
      id: region.id,
      name: region.name,
    })),
    modelOptionsByMake: getKnownVehicleModelsByMake(marketplaceModelsByMake),
  };
}
