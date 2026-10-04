import { cache } from "react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPublicListingSellerAccess } from "@/lib/listings/dealer-visibility";
import { canViewListing } from "@/lib/listings/visibility";
import {
  isPreviewPackListing,
  previewPacksVisibleOnFrontend,
} from "@/lib/preview-packs/frontend-visibility";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { blocksSignedListingDelivery } from "@/lib/media/delivery-access";
import type { ListingPhotoSource } from "@/lib/images/photo";

const listingImageSelect = {
  id: true,
  url: true,
  publicId: true,
  provider: true,
  assetId: true,
  version: true,
  width: true,
  height: true,
  format: true,
  bytes: true,
  focalX: true,
  focalY: true,
  imageKitFileId: true,
  imageKitFilePath: true,
  listing: {
    select: {
      id: true,
      status: true,
      expiresAt: true,
      userId: true,
      dealerId: true,
      previewPackId: true,
      user: { select: { authUserId: true, email: true, disabledAt: true, deletedAt: true } },
      dealer: { select: { isAdminPreview: true } },
      previewPack: { select: { enabled: true } },
    },
  },
} as const;

export const loadAuthorizedListingPhoto = cache(async (imageId: string): Promise<ListingPhotoSource | null> => {
  const image = await db.listingImage.findUnique({
    where: { id: imageId },
    select: listingImageSelect,
  });
  if (!image) return null;
  const viewer = await getCurrentUser();
  const dealerAccess = await hasPublicListingSellerAccess(
    image.listing.dealerId,
    Boolean(image.listing.user.disabledAt),
    Boolean(image.listing.user.deletedAt),
  );
  const sampleVisibility = await getSampleVisibility();
  if (
    blocksSignedListingDelivery({
      listingId: image.listing.id,
      authUserId: image.listing.user.authUserId,
      dealerId: image.listing.dealerId,
      isAdminPreview: image.listing.dealer?.isAdminPreview === true,
      sampleVisibility,
      status: image.listing.status,
      previewPackId: image.listing.previewPackId,
      ownerEmail: image.listing.user.email,
      canView: canViewListing({
        dealerAccess,
        status: image.listing.status,
        expiresAt: image.listing.expiresAt,
        listingUserId: image.listing.userId,
        viewer,
        previewPackEnabled: image.listing.previewPack?.enabled ?? false,
        previewPackId: image.listing.previewPackId,
        dealerIsAdminPreview: image.listing.dealer?.isAdminPreview === true,
        ownerAuthUserId: image.listing.user.authUserId,
        ownerEmail: image.listing.user.email,
      }),
    })
  ) {
    return null;
  }
  return image;
});

export const loadAuthorizedRevisionPhoto = cache(async (imageId: string): Promise<ListingPhotoSource | null> => {
  const image = await db.listingRevisionImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      url: true,
      publicId: true,
      provider: true,
      assetId: true,
      version: true,
      width: true,
      height: true,
      format: true,
      bytes: true,
      focalX: true,
      focalY: true,
      imageKitFileId: true,
      imageKitFilePath: true,
      revision: {
        select: {
          listing: {
            select: {
              userId: true,
              status: true,
              previewPackId: true,
              user: { select: { authUserId: true, email: true } },
              dealer: { select: { isAdminPreview: true } },
            },
          },
        },
      },
    },
  });
  if (!image) return null;
  const viewer = await getCurrentUser();
  const listing = image.revision.listing;
  if (
    isPreviewPackListing({
      status: listing.status,
      previewPackId: listing.previewPackId,
      dealerIsAdminPreview: listing.dealer?.isAdminPreview === true,
      ownerAuthUserId: listing.user.authUserId,
      ownerEmail: listing.user.email,
    })
    && !previewPacksVisibleOnFrontend()
  ) {
    return null;
  }
  const owner = listing.userId;
  if (!viewer || (viewer.role !== "ADMIN" && viewer.id !== owner)) return null;
  return image;
});
