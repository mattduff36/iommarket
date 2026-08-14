export const LISTING_IMAGE_FOLDER = "iommarket/listings";

export const IMAGE_CONSTRAINTS = {
  maxFileSizeBytes: 10 * 1024 * 1024,
  minLongEdge: 800,
  minShortEdge: 480,
  maxMegapixels: 50,
  allowedFormats: ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const,
  folder: LISTING_IMAGE_FOLDER,
  deliveryType: "private",
} as const;

export const LISTING_PHOTO_FIT_THRESHOLD = 0.8;

export const LISTING_PHOTO_WIDTHS = [160, 320, 480, 640, 800, 960, 1200, 1600] as const;

export const LISTING_PHOTO_FRAMES = {
  card: { width: 4, height: 3, aspectClass: "aspect-[4/3]" },
  gallery: { width: 16, height: 10, aspectClass: "aspect-[16/10]" },
  thumb: { width: 16, height: 10, aspectClass: "aspect-[16/10]" },
  admin: { width: 1, height: 1, aspectClass: "aspect-square" },
  preview: { width: 16, height: 10, aspectClass: "aspect-[16/10]" },
  social: { width: 1200, height: 630, aspectClass: "aspect-[1200/630]" },
} as const;

export type ListingPhotoFrame = keyof typeof LISTING_PHOTO_FRAMES;

export const LISTING_IMAGE_ACCEPT = IMAGE_CONSTRAINTS.allowedFormats
  .map((format) => `.${format}`)
  .join(",");

export function normalizeImageFormat(value: string | null | undefined): string | null {
  const format = value?.trim().toLowerCase();
  if (!format) return null;
  if (format === "jpeg") return "jpg";
  return format;
}

export function isAllowedListingImageFormat(value: string | null | undefined): boolean {
  const format = normalizeImageFormat(value);
  return format !== null && IMAGE_CONSTRAINTS.allowedFormats.includes(
    format as (typeof IMAGE_CONSTRAINTS.allowedFormats)[number],
  );
}

export function validateListingImageBounds({
  width,
  height,
  bytes,
}: {
  width: number;
  height: number;
  bytes: number;
}): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "The uploaded file is empty.";
  }
  if (bytes > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return "Images must be 10MB or smaller.";
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "Images must include valid pixel dimensions.";
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge < IMAGE_CONSTRAINTS.minLongEdge || shortEdge < IMAGE_CONSTRAINTS.minShortEdge) {
    return `Images must be at least ${IMAGE_CONSTRAINTS.minLongEdge}×${IMAGE_CONSTRAINTS.minShortEdge}px.`;
  }
  if (width * height > IMAGE_CONSTRAINTS.maxMegapixels * 1_000_000) {
    return `Images must be ${IMAGE_CONSTRAINTS.maxMegapixels} megapixels or smaller.`;
  }
  return null;
}
