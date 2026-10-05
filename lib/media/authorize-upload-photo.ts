import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { imageRecordFromIntent } from "@/lib/media/stored-image";
import { MANAGED_IMAGEKIT_DELIVERY_TYPE } from "@/lib/media/managed-policy";
import { loadAuthorizedListingPhoto, loadAuthorizedRevisionPhoto } from "@/lib/media/authorize-listing-photo";
import type { ListingPhotoSource } from "@/lib/images/photo";

/** Owner-only verified previews. Raw quarantine never reaches the image signer. */
export async function loadAuthorizedUploadPhoto(intentId: string): Promise<ListingPhotoSource | null> {
  const viewer = await getCurrentUser();
  if (!viewer || viewer.disabledAt || viewer.deletedAt) return null;
  const intent = await db.listingImageUploadIntent.findUnique({
    where: { id: intentId },
    include: { image: { select: { id: true } }, revisionImage: { select: { id: true } } },
  });
  if (!intent || intent.userId !== viewer.id ||
    !["imagekit", MANAGED_IMAGEKIT_DELIVERY_TYPE].includes(intent.deliveryType)) return null;
  if (intent.status === "CONSUMED") {
    if (intent.image) return loadAuthorizedListingPhoto(intent.image.id);
    if (intent.revisionImage) return loadAuthorizedRevisionPhoto(intent.revisionImage.id);
    return null;
  }
  if (intent.status !== "VERIFIED" || intent.expiresAt.getTime() <= Date.now()) return null;
  try {
    const stored = imageRecordFromIntent(intent);
    return { ...stored, uploadIntentId: intent.id, deliverySource: "upload", version: intent.version,
      width: intent.width, height: intent.height, format: intent.format, bytes: intent.bytes };
  } catch { return null; }
}
