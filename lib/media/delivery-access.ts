import type { ListingStatus } from "@prisma/client";
import {
  isHiddenSampleDealer,
  isHiddenSampleListing,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";
import {
  isPreviewPackDealer,
  isPreviewPackListing,
  previewPacksVisibleOnFrontend,
} from "@/lib/preview-packs/frontend-visibility";

export function blocksSignedListingDelivery(input: {
  listingId?: string;
  authUserId: string;
  dealerId: string | null;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
  canView: boolean;
  status?: ListingStatus | null;
  previewPackId?: string | null;
  ownerEmail?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  if (isHiddenSampleListing(input)) return true;
  if (
    !previewPacksVisibleOnFrontend(input.env)
    && isPreviewPackListing({
      status: input.status,
      previewPackId: input.previewPackId,
      dealerIsAdminPreview: input.isAdminPreview,
      ownerAuthUserId: input.authUserId,
      ownerEmail: input.ownerEmail,
    })
  ) {
    return true;
  }
  return !input.canView;
}

export function allowsSignedDealerLogo(input: {
  storedLogo: boolean;
  authUserId: string;
  email?: string | null;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
  ownerDisabled: boolean;
  publiclyVisible: boolean;
  viewerIsAdmin: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  if (!input.storedLogo || input.ownerDisabled) return false;
  if (isHiddenSampleDealer(input)) return false;
  if (
    !previewPacksVisibleOnFrontend(input.env)
    && isPreviewPackDealer({
      isAdminPreview: input.isAdminPreview,
      authUserId: input.authUserId,
      email: input.email,
    })
  ) {
    return false;
  }
  return input.publiclyVisible || input.viewerIsAdmin;
}
