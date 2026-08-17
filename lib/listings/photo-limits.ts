export const PRIVATE_LISTING_PHOTO_LIMIT = 10;
export const FEATURED_LISTING_PHOTO_LIMIT = 20;

type ListingPhotoAccessSubject = {
  role: "USER" | "DEALER" | "ADMIN";
  dealerProfile: { id: string } | null;
};

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

export function getSellerListingPhotoLimit(
  user: ListingPhotoAccessSubject | null | undefined,
  listing: { dealerId: string | null; featured: boolean },
) {
  const hasDealerAccess =
    user !== null &&
    user !== undefined &&
    (user.role === "DEALER" || user.role === "ADMIN") &&
    user.dealerProfile !== null;

  return getListingPhotoLimit({
    isDealer: listing.dealerId !== null && hasDealerAccess,
    isFeatured: listing.featured,
  });
}

export function getListingPhotoLimitError(maxImages: number): string {
  return `Maximum ${maxImages} images allowed`;
}
