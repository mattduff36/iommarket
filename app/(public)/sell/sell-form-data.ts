import { db } from "@/lib/db";
import { getActiveVehicleMakes } from "@/lib/vehicle-catalogue/queries";

export async function getSellFormData() {
  const [categories, regions, vehicleMakes] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.region.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getActiveVehicleMakes(),
  ]);

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
    vehicleMakes,
  };
}
