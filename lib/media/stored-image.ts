import { MANAGED_IMAGEKIT_DELIVERY_TYPE, isManagedListingPath, managedMediaPublicId, parseManagedMediaPath } from "@/lib/media/managed-policy";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
import { IMAGEKIT_DISPOSABLE_PREFIX, IMAGEKIT_PRIVATE_URL_PREFIX } from "@/lib/media/config";
import type { ListingImageProvider } from "@prisma/client";

export interface VerifiedImageIntent {
  id?: string;
  userId?: string;
  publicId: string;
  assetId: string | null;
  version: string | null;
  format: string | null;
  deliveryType: string;
  folder: string;
  imageKitFileId?: string | null;
  imageKitFilePath?: string | null;
}

export function imageRecordFromIntent(intent: VerifiedImageIntent): {
  url: string;
  provider: ListingImageProvider;
  publicId: string;
  assetId: string | null;
  imageKitFileId: string | null;
  imageKitFilePath: string | null;
} {
  if (intent.deliveryType === MANAGED_IMAGEKIT_DELIVERY_TYPE) {
    const fileId = intent.imageKitFileId;
    const filePath = intent.imageKitFilePath;
    const parsed = filePath ? parseManagedMediaPath(filePath) : null;
    if (!fileId || !/^[A-Za-z0-9_-]{1,100}$/.test(fileId) || !filePath || !isManagedListingPath(filePath) ||
      !parsed || parsed.kind !== "listings" || managedMediaPublicId(filePath) !== intent.publicId ||
      (intent.id && parsed.intentId !== intent.id) || (intent.userId && parsed.userId !== intent.userId)) {
      throw new Error("Managed ImageKit upload is missing its verified final identity.");
    }
    return { url: IMAGEKIT_PRIVATE_URL_PREFIX + filePath, provider: "IMAGEKIT", publicId: intent.publicId,
      assetId: fileId, imageKitFileId: fileId, imageKitFilePath: filePath };
  }
  if (intent.deliveryType === "imagekit") {
    const fileId = intent.imageKitFileId ?? intent.assetId;
    const filePath = intent.imageKitFilePath ?? intent.folder;
    if (!fileId || !filePath.startsWith(IMAGEKIT_DISPOSABLE_PREFIX)) {
      throw new Error("ImageKit upload is missing its private disposable file.");
    }
    return {
      url: `${IMAGEKIT_PRIVATE_URL_PREFIX}${filePath}`,
      provider: "IMAGEKIT",
      publicId: intent.publicId,
      assetId: fileId,
      imageKitFileId: fileId,
      imageKitFilePath: filePath,
    };
  }
  return {
    url: buildCanonicalListingImageUrl({
      publicId: intent.publicId,
      version: intent.version,
      format: intent.format,
      provider: "CLOUDINARY",
      url: "",
    }),
    provider: "CLOUDINARY",
    publicId: intent.publicId,
    assetId: intent.assetId,
    imageKitFileId: null,
    imageKitFilePath: null,
  };
}

export function cleanupDeliveryForRemovedImage(image: {
  provider: ListingImageProvider;
  publicId: string;
  imageKitFileId?: string | null;
  imageKitFilePath?: string | null;
}) {
  if (image.provider === "IMAGEKIT" && (image.publicId.startsWith("imagekit/") || image.imageKitFilePath?.startsWith("/iommarket-media/"))) {
    if (!image.imageKitFileId || !image.imageKitFilePath || !isManagedListingPath(image.imageKitFilePath) ||
      managedMediaPublicId(image.imageKitFilePath) !== image.publicId) throw new Error("Managed cleanup identity is incomplete.");
    return { publicId: image.publicId, deliveryType: MANAGED_IMAGEKIT_DELIVERY_TYPE,
      imageKitFileId: image.imageKitFileId, imageKitFilePath: image.imageKitFilePath };
  }
  if (
    (image.provider === "IMAGEKIT" || image.provider === "EXTERNAL") &&
    image.publicId.startsWith("imagekit-dev/")
  ) {
    return {
      publicId: image.publicId,
      deliveryType: "imagekit",
      imageKitFileId: image.imageKitFileId ?? null,
      imageKitFilePath: image.imageKitFilePath ?? null,
    };
  }
  if (image.provider === "CLOUDINARY" && image.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)) {
    return {
      publicId: image.publicId,
      deliveryType: IMAGE_CONSTRAINTS.deliveryType,
      // Preserve the migrated identity for the separate retention/retirement audit.
      // A Cloudinary cleanup must never make the ImageKit copy untraceable.
      imageKitFileId: image.imageKitFileId ?? null,
      imageKitFilePath: image.imageKitFilePath ?? null,
    };
  }
  return null;
}
