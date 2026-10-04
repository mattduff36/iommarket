import {
  isHiddenSampleDealer,
  isHiddenSampleListing,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";

export function blocksSignedListingDelivery(input: {
  listingId?: string;
  authUserId: string;
  dealerId: string | null;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
  canView: boolean;
}) {
  if (isHiddenSampleListing(input)) return true;
  return !input.canView;
}

export function allowsSignedDealerLogo(input: {
  storedLogo: boolean;
  authUserId: string;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
  ownerDisabled: boolean;
  publiclyVisible: boolean;
  viewerIsAdmin: boolean;
}) {
  if (!input.storedLogo || input.ownerDisabled) return false;
  if (isHiddenSampleDealer(input)) return false;
  return input.publiclyVisible || input.viewerIsAdmin;
}
