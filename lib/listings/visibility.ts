import type { ListingStatus } from "@prisma/client";
import { isListingEffectivelyExpired } from "@/lib/listings/expiry";

export const PUBLIC_LISTING_STATUSES: readonly ListingStatus[] = ["LIVE", "SOLD"];

export function isListingPubliclyVisible(input: {
  status: ListingStatus;
  expiresAt: Date | null;
}) {
  if (input.status === "SOLD") return true;
  if (input.status !== "LIVE") return false;
  return !isListingEffectivelyExpired(input);
}

export function isAdminPreviewListing(status: ListingStatus) {
  return status === "ADMIN_PREVIEW";
}

export function canViewListing(input: {
  status: ListingStatus;
  expiresAt: Date | null;
  listingUserId: string;
  viewer?: { id: string; role: string } | null;
  previewPackEnabled?: boolean | null;
}) {
  if (isAdminPreviewListing(input.status)) {
    return input.viewer?.role === "ADMIN" && input.previewPackEnabled === true;
  }
  if (isListingPubliclyVisible(input)) return true;
  if (!input.viewer) return false;
  if (input.viewer.role === "ADMIN") return true;
  return input.viewer.id === input.listingUserId;
}

export function canInspectPendingRevision(input: {
  status: ListingStatus;
  reviewRequested: boolean;
  viewer?: { role: string } | null;
}) {
  return (
    input.status === "LIVE" &&
    input.reviewRequested &&
    input.viewer?.role === "ADMIN"
  );
}

export function isListingEditable(status: ListingStatus) {
  return (
    status === "DRAFT" ||
    status === "EXPIRED" ||
    status === "LIVE" ||
    status === "TAKEN_DOWN" ||
    status === "REJECTED"
  );
}

export function isInPlaceEditable(status: ListingStatus) {
  return (
    status === "DRAFT" ||
    status === "EXPIRED" ||
    status === "TAKEN_DOWN" ||
    status === "REJECTED"
  );
}

export function usesPendingRevision(status: ListingStatus) {
  return status === "LIVE";
}
