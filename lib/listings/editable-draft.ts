import { db } from "@/lib/db";

export interface EditableDraft {
  id: string;
  title: string;
  description: string;
  price: number;
  categoryId: string;
  regionId: string;
  trustDeclarationAccepted: boolean;
  featured: boolean;
  photoRevision: number;
  images: Array<{
    id: string;
    url: string;
    publicId: string;
    order: number;
    provider: "CLOUDINARY" | "EXTERNAL";
    assetId: string | null;
    version: string | null;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number | null;
    uploadIntentId: string | null;
    focalX: number | null;
    focalY: number | null;
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
          id: true,
          url: true,
          publicId: true,
          order: true,
          provider: true,
          assetId: true,
          version: true,
          width: true,
          height: true,
          format: true,
          bytes: true,
          uploadIntentId: true,
          focalX: true,
          focalY: true,
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
    featured: listing.featured,
    photoRevision: listing.photoRevision,
    images: listing.images.map((image) => ({
      id: image.id,
      url: image.url,
      publicId: image.publicId,
      order: image.order,
      provider: image.provider,
      assetId: image.assetId,
      version: image.version,
      width: image.width,
      height: image.height,
      format: image.format,
      bytes: image.bytes,
      uploadIntentId: image.uploadIntentId,
      focalX: image.focalX,
      focalY: image.focalY,
    })),
    attributes: listing.attributeValues.map((attribute) => ({
      attributeDefinitionId: attribute.attributeDefinitionId,
      value: attribute.value,
    })),
  };
}
