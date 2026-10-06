import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  attributeSortSpec,
  restoreIdOrder,
  sortListingIdsByAttribute,
  type AttributeSearchSort,
} from "@/lib/search/search-order";

export async function pageListingIdsByAttribute(input: {
  where: Prisma.ListingWhereInput;
  sort: AttributeSearchSort;
  skip: number;
  take: number;
}): Promise<string[]> {
  const spec = attributeSortSpec(input.sort);
  const rows = await db.listing.findMany({
    where: input.where,
    select: {
      id: true,
      createdAt: true,
      attributeValues: {
        where: { attributeDefinition: { slug: spec.slug } },
        select: { value: true },
        take: 1,
      },
    },
  });
  return sortListingIdsByAttribute(
    rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      value: row.attributeValues[0]?.value ?? null,
    })),
    spec.direction,
  ).slice(input.skip, input.skip + input.take);
}

export async function findListingsInAttributeOrder<T extends { id: string }>(input: {
  where: Prisma.ListingWhereInput;
  sort: AttributeSearchSort;
  skip: number;
  take: number;
  load: (ids: string[]) => Promise<T[]>;
}): Promise<T[]> {
  const ids = await pageListingIdsByAttribute(input);
  if (ids.length === 0) return [];
  return restoreIdOrder(await input.load(ids), ids);
}
