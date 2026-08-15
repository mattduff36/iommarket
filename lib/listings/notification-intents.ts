import type {
  ListingLifecycleAction,
  ListingModerationReason,
  ListingStatus,
} from "@prisma/client";

export interface ListingNotificationIntent {
  eventId: string;
  listingId: string;
  action: ListingLifecycleAction;
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus;
  reasonCode: ListingModerationReason | null;
}

export function shouldNotifySellerStatusChange(intent: ListingNotificationIntent) {
  if (intent.action === "SYSTEM_BACKFILL") return false;
  if (intent.fromStatus == null) return false;
  return intent.fromStatus !== intent.toStatus;
}

export function shouldNotifyAdminSubmission(intent: ListingNotificationIntent) {
  return intent.action === "SUBMIT" || intent.action === "SUBMIT_REVISION";
}

export function isListingResubmit(intent: ListingNotificationIntent) {
  return (
    intent.action === "SUBMIT" &&
    (intent.fromStatus === "TAKEN_DOWN" || intent.fromStatus === "REJECTED")
  );
}
