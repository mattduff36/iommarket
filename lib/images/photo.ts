import type { ListingImageProvider } from "@prisma/client";

export const listingPhotoSelect = {
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
} as const;

export interface ListingPhotoSource {
  id?: string;
  uploadIntentId?: string | null;
  url: string;
  publicId: string;
  provider: ListingImageProvider | "CLOUDINARY" | "EXTERNAL";
  assetId?: string | null;
  version?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  bytes?: number | null;
  focalX?: number | null;
  focalY?: number | null;
  order?: number;
}

export function toListingPhotoSource(
  image: {
    id?: string;
    uploadIntentId?: string | null;
    url: string;
    publicId: string;
    provider?: ListingImageProvider | "CLOUDINARY" | "EXTERNAL" | null;
    assetId?: string | null;
    version?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    bytes?: number | null;
    focalX?: number | null;
    focalY?: number | null;
    order?: number;
  } | null | undefined,
): ListingPhotoSource | undefined {
  if (!image?.url) return undefined;
  return {
    id: image.id,
    uploadIntentId: image.uploadIntentId,
    url: image.url,
    publicId: image.publicId,
    provider: image.provider ?? (image.publicId.startsWith("demo/") ? "EXTERNAL" : "CLOUDINARY"),
    assetId: image.assetId,
    version: image.version,
    width: image.width,
    height: image.height,
    format: image.format,
    bytes: image.bytes,
    focalX: image.focalX,
    focalY: image.focalY,
    order: image.order,
  };
}

export function hasValidPhotoDimensions(photo: Pick<ListingPhotoSource, "width" | "height">) {
  return (
    typeof photo.width === "number" &&
    typeof photo.height === "number" &&
    photo.width > 0 &&
    photo.height > 0
  );
}

export function hasValidFocalPoint(photo: Pick<ListingPhotoSource, "focalX" | "focalY">) {
  return (
    typeof photo.focalX === "number" &&
    typeof photo.focalY === "number" &&
    Number.isFinite(photo.focalX) &&
    Number.isFinite(photo.focalY) &&
    photo.focalX >= 0 &&
    photo.focalX <= 1 &&
    photo.focalY >= 0 &&
    photo.focalY <= 1
  );
}
