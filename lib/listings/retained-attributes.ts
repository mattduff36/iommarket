import { db } from "@/lib/db";
import type { ListingAttributeInputLike } from "@/lib/listings/attribute-ui";
import { getOpenRevision } from "@/lib/listings/revisions";

export async function loadRetainedAttributeValues(params: {
  listingId: string;
  storedCategoryId: string;
  nextCategoryId: string;
  pendingRevision: boolean;
}): Promise<ListingAttributeInputLike[]> {
  if (params.pendingRevision) {
    const open = await getOpenRevision(params.listingId);
    if (open) {
      if (open.categoryId !== params.nextCategoryId) return [];
      return open.attributeValues.map((attribute) => ({
        attributeDefinitionId: attribute.attributeDefinitionId,
        value: attribute.value,
      }));
    }
  }

  if (params.storedCategoryId !== params.nextCategoryId) return [];
  return db.listingAttributeValue.findMany({
    where: { listingId: params.listingId },
    select: { attributeDefinitionId: true, value: true },
  });
}
