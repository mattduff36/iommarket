import type { Prisma } from "@prisma/client";
import { attributeDefsForCategory } from "./catalog-attributes";
import { CATEGORY_DEFS, MARKETPLACE_REGIONS } from "./catalog";

type TransactionClient = Prisma.TransactionClient;

export async function upsertCatalog(tx: TransactionClient) {
  const regions: Record<string, string> = {};
  for (const region of MARKETPLACE_REGIONS) {
    const row = await tx.region.upsert({
      where: { slug: region.slug },
      update: {
        name: region.name,
        active: true,
        sortOrder: region.sortOrder,
      },
      create: {
        name: region.name,
        slug: region.slug,
        active: true,
        sortOrder: region.sortOrder,
      },
    });
    regions[region.slug] = row.id;
  }

  const categories: Record<string, string> = {};
  const attributes: Record<string, Record<string, string>> = {};
  for (const category of CATEGORY_DEFS) {
    const row = await tx.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        active: true,
        sortOrder: category.sortOrder,
      },
      create: {
        name: category.name,
        slug: category.slug,
        active: true,
        sortOrder: category.sortOrder,
      },
    });
    categories[category.slug] = row.id;
    attributes[category.slug] = {};
    const defs = attributeDefsForCategory(category.slug);
    for (const attr of defs) {
      const created = await tx.attributeDefinition.upsert({
        where: {
          categoryId_slug: { categoryId: row.id, slug: attr.slug },
        },
        update: {
          name: attr.name,
          dataType: attr.dataType,
          required: attr.required,
          sortOrder: attr.sortOrder,
          options: attr.options,
        },
        create: {
          categoryId: row.id,
          name: attr.name,
          slug: attr.slug,
          dataType: attr.dataType,
          required: attr.required,
          sortOrder: attr.sortOrder,
          options: attr.options,
        },
      });
      attributes[category.slug][attr.slug] = created.id;
    }
  }

  return { regions, categories, attributes };
}
