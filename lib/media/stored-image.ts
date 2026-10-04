import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { buildCanonicalListingImageUrl } from "@/lib/images/cloudinary-url";
import { IMAGEKIT_DISPOSABLE_PREFIX, IMAGEKIT_PRIVATE_URL_PREFIX } from "@/lib/media/config";
import type { ListingImageProvider } from "@prisma/client";

export interface VerifiedImageIntent {
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
      imageKitFileId: null,
      imageKitFilePath: null,
    };
  }
  return null;
}
