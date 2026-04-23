import { db } from "@/lib/db";

export interface EditableDraft {
  id: string;
  title: string;
  description: string;
  price: number;
  categoryId: string;
  regionId: string;
  trustDeclarationAccepted: boolean;
  images: Array<{
    url: string;
    publicId: string;
    order: number;
  }>;
  attributes: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}

interface GetEditableDraftInput {
  draftId: string;
  userId: string;
  dealerId: string | null;
}

export async function getEditableDraft({
  draftId,
  userId,
  dealerId,
}: GetEditableDraftInput): Promise<EditableDraft | null> {
  const listing = await db.listing.findFirst({
    where: {
      id: draftId,
      userId,
      dealerId,
      status: "DRAFT",
    },
    include: {
      images: {
        orderBy: { order: "asc" },
        select: {
          url: true,
          publicId: true,
          order: true,
        },
      },
      attributeValues: {
        select: {
          attributeDefinitionId: true,
          value: true,
        },
      },
    },
  });

  if (!listing) {
    return null;
  }

  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    price: listing.price / 100,
    categoryId: listing.categoryId,
    regionId: listing.regionId,
    trustDeclarationAccepted: listing.trustDeclarationAccepted,
    images: listing.images.map((image) => ({
      url: image.url,
      publicId: image.publicId,
      order: image.order,
    })),
    attributes: listing.attributeValues.map((attribute) => ({
      attributeDefinitionId: attribute.attributeDefinitionId,
      value: attribute.value,
    })),
  };
}
