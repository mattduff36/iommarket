export const PRIVATE_LISTING_PHOTO_LIMIT = 10;
export const FEATURED_LISTING_PHOTO_LIMIT = 20;

export function getListingPhotoLimit({
  isDealer,
  isFeatured,
}: {
  isDealer: boolean;
  isFeatured: boolean;
}): number {
  return isDealer || isFeatured
    ? FEATURED_LISTING_PHOTO_LIMIT
    : PRIVATE_LISTING_PHOTO_LIMIT;
}

export function getListingPhotoLimitError(maxImages: number): string {
  return `Maximum ${maxImages} images allowed`;
}
