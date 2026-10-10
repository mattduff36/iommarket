import { parseManagedMediaPath, managedMediaPublicId } from "../media/managed-policy";
import { isTrustedListingPublicId } from "@/lib/images/cloudinary-url";
import type { OwnedListingImage } from "./types";



export function isOwnedListingImage(image: OwnedListingImage) {
  if (image.provider !== "CLOUDINARY" && image.provider !== "IMAGEKIT") return false;
  if (!isTrustedListingPublicId(image.publicId)) return false;
  if (image.provider === "IMAGEKIT") {
    const path = image.imageKitFilePath;
    return Boolean(path && parseManagedMediaPath(path)?.kind === "imports" &&
      managedMediaPublicId(path) === image.publicId && image.imageKitFileId && image.cleanupReceiptId &&
      image.url === `imagekit-private:${path}` && image.width >= 300 && image.height >= 200);
  }
  try {
    const url = new URL(image.url);
    const host = "res.cloudinary.com";
    if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port) return false;
  } catch { return false; }
  if (!Number.isInteger(image.width) || image.width < 300) return false;
  if (!Number.isInteger(image.height) || image.height < 200) return false;
  return true;
}

export function ownedImagesOrNull(images: OwnedListingImage[]) {
  if (images.length === 0 || images.some((image) => !isOwnedListingImage(image))) return null;
  return [...images].sort((left, right) => left.order - right.order);
}
