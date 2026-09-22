import type { Prisma } from "@prisma/client";
import { CATEGORY_DEFS, MARKETPLACE_REGIONS, VEHICLE_ATTRIBUTE_DEFS } from "./catalog";

type TransactionClient = Prisma.TransactionClient;

export async function resolveCatalog(tx: TransactionClient) {
  const regionRows = await tx.region.findMany({
    select: { id: true, slug: true },
  });
  const categoryRows = await tx.category.findMany({
    select: { id: true, slug: true },
  });
  const attributeRows = await tx.attributeDefinition.findMany({
    select: { id: true, slug: true, categoryId: true },
  });

  const regions: Record<string, string> = {};
  for (const region of MARKETPLACE_REGIONS) {
    const row = regionRows.find((item) => item.slug === region.slug);
    if (!row) throw new Error(`Missing catalog region ${region.slug}.`);
    regions[region.slug] = row.id;
  }

  const categories: Record<string, string> = {};
  const attributes: Record<string, Record<string, string>> = {};
  for (const category of CATEGORY_DEFS) {
    const row = categoryRows.find((item) => item.slug === category.slug);
    if (!row) throw new Error(`Missing catalog category ${category.slug}.`);
    categories[category.slug] = row.id;
    attributes[category.slug] = {};
    for (const attr of attributeRows.filter((item) => item.categoryId === row.id)) {
      attributes[category.slug][attr.slug] = attr.id;
    }
    for (const required of VEHICLE_ATTRIBUTE_DEFS.filter((attr) => attr.required)) {
      if (!attributes[category.slug][required.slug]) {
        throw new Error(`Missing catalog attribute ${category.slug}/${required.slug}.`);
      }
    }
  }

  return { regions, categories, attributes };
}
