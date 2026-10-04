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
}

export function imageRecordFromIntent(intent: VerifiedImageIntent): {
  url: string;
  provider: ListingImageProvider;
  publicId: string;
  assetId: string | null;
} {
  if (intent.deliveryType === "imagekit") {
    if (!intent.assetId || !intent.folder.startsWith(IMAGEKIT_DISPOSABLE_PREFIX)) {
      throw new Error("ImageKit upload is missing its private disposable file.");
    }
    return {
      url: `${IMAGEKIT_PRIVATE_URL_PREFIX}${intent.folder}`,
      provider: "EXTERNAL",
      publicId: intent.publicId,
      assetId: intent.assetId,
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
  };
}

export function cleanupDeliveryForRemovedImage(image: { provider: ListingImageProvider; publicId: string }) {
  if (image.provider === "EXTERNAL" && image.publicId.startsWith("imagekit-dev/")) {
    return { publicId: image.publicId, deliveryType: "imagekit" };
  }
  if (image.provider === "CLOUDINARY" && image.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)) {
    return { publicId: image.publicId, deliveryType: IMAGE_CONSTRAINTS.deliveryType };
  }
  return null;
}
