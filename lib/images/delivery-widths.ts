import type { ListingPhotoFrame } from "@/lib/images/constraints";
import type { ListingPhotoSource } from "@/lib/images/photo";

/**
 * Pixel widths for protected listing photos served by /api/media/listing-photo.
 *
 * Frame numbers such as 16, 4 and 1 are aspect ratios, not rendition widths.
 * Next.js would otherwise advertise 3840w, the media route used to accept any
 * width up to 2400, and ImageKit snapped that onto a ladder that stopped at
 * 1600. Candidate generation, request validation and ImageKit sizing now share
 * this ladder, so a candidate is never advertised and then silently reduced.
 *
 * The cap is 2400px. The listing gallery is about 800 CSS pixels inside the
 * 1280px page column, which is 1600 device pixels at 2×. A fullscreen lightbox
 * on a 1200 CSS-pixel window at 2× is 2400. That covers desktop and high-density
 * screens without a 3840w candidate, and without enlarging photos whose long
 * edge is around 3000px. The browser applies device pixel ratio once when it
 * picks from srcset; loaders pass that candidate through unchanged.
 *
 * Blur backgrounds stay at 320px and do not choose the foreground width.
 * Cloudinary rollback keeps LISTING_PHOTO_WIDTHS, which still ends at 1600.
 */
export const LISTING_PHOTO_DELIVERY_WIDTHS = [
  160, 320, 480, 640, 800, 960, 1200, 1600, 1920, 2400,
] as const;

export const LISTING_PHOTO_DELIVERY_MAX_WIDTH =
  LISTING_PHOTO_DELIVERY_WIDTHS[LISTING_PHOTO_DELIVERY_WIDTHS.length - 1];

export const LISTING_PHOTO_BLUR_WIDTH = 320;

/** Used only when a caller opts out of srcset. It is a ladder width, not an aspect ratio. */
export const LISTING_PHOTO_UNOPTIMIZED_WIDTH = 1200;

export type ListingPhotoDeliveryWidth = (typeof LISTING_PHOTO_DELIVERY_WIDTHS)[number];

/**
 * Full content width below the listing page's two-column layout. From 1024px
 * the gallery is two of three columns (~62vw until the 1280px page cap), then
 * a fixed ~800px column.
 */
export const LISTING_GALLERY_SIZES = "(max-width: 1023px) 100vw, (max-width: 1279px) 62vw, 800px";

/** 144px strip below the small breakpoint, then roughly a quarter of the gallery column. */
export const LISTING_GALLERY_THUMB_SIZES = "(max-width: 639px) 144px, (max-width: 1023px) 25vw, 200px";

export const LISTING_LIGHTBOX_SIZES = "100vw";

/** Lightbox strip thumbnails are w-28 (112px). */
export const LISTING_LIGHTBOX_THUMB_SIZES = "112px";

/** Search and similar-listing grids are two, three, then four columns. */
export const LISTING_CARD_SIZES = "(max-width: 767px) 50vw, (max-width: 1023px) 34vw, 320px";

/**
 * Search list view keeps the card's full-width 4:3 image, so the slot is the
 * page column rather than a grid cell. A 1200px slot at 2× reaches the 2400
 * cap. Grid cards stay on LISTING_CARD_SIZES and do not.
 */
export const LISTING_CARD_LIST_SIZES = "(max-width: 1023px) 100vw, 1200px";

export function isListingPhotoDeliveryWidth(width: number): width is ListingPhotoDeliveryWidth {
  return (LISTING_PHOTO_DELIVERY_WIDTHS as readonly number[]).includes(width);
}

export function listingPhotoDeliveryUrl(
  photo: Pick<ListingPhotoSource, "id" | "deliverySource">,
  frame: ListingPhotoFrame,
  mode: "fill" | "fit" | "blur",
  width: number,
) {
  const params = new URLSearchParams({
    imageId: photo.id ?? "",
    source: photo.deliverySource ?? "listing",
    mode,
    frame,
    w: String(width),
  });
  return `/api/media/listing-photo?${params.toString()}`;
}
