import { db } from "@/lib/db";

export async function getSellFormData() {
  const [categories, regions] = await Promise.all([
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
  };
}
