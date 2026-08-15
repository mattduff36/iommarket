import { db } from "@/lib/db";
import { getOrCreateDraftRevision, getOpenRevision } from "@/lib/listings/revisions";
import { isInPlaceEditable, usesPendingRevision } from "@/lib/listings/visibility";

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
  editMode?: "draft" | "revision" | "resubmit";
  revisionPending?: boolean;
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

function toEditableImages(
  images: EditableDraft["images"],
): EditableDraft["images"] {
  return images.map((image) => ({
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
  }));
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
    },
    include: {
      images: {
        orderBy: { order: "asc" },
      },
      attributeValues: {
        select: {
          attributeDefinitionId: true,
          value: true,
        },
      },
    },
  });

  if (!listing) return null;
  if (!isInPlaceEditable(listing.status) && !usesPendingRevision(listing.status)) {
    return null;
  }

  if (usesPendingRevision(listing.status)) {
    const revision =
      (await getOpenRevision(listing.id)) ??
      (await getOrCreateDraftRevision({ listingId: listing.id, userId }));
    return {
      id: listing.id,
      title: revision.title,
      description: revision.description,
      price: revision.price / 100,
      categoryId: revision.categoryId,
      regionId: revision.regionId,
      trustDeclarationAccepted: revision.trustDeclarationAccepted,
      featured: listing.featured,
      photoRevision: revision.version,
      editMode: "revision",
      revisionPending: revision.status === "PENDING",
      images: toEditableImages(revision.images),
      attributes: revision.attributeValues.map((attribute) => ({
        attributeDefinitionId: attribute.attributeDefinitionId,
        value: attribute.value,
      })),
    };
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
    editMode: listing.status === "DRAFT" || listing.status === "EXPIRED" ? "draft" : "resubmit",
    revisionPending: false,
    images: toEditableImages(listing.images),
    attributes: listing.attributeValues.map((attribute) => ({
      attributeDefinitionId: attribute.attributeDefinitionId,
      value: attribute.value,
    })),
  };
}
