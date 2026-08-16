export const DATASET_VERSION = "DEMO-SEED-4A91C2.1";
export const PLACEHOLDER_AUTH_RE = /^00000000-0000-0000-0000-/;
export const SEED_PAYMENT_NAMESPACE = "seed:demo:";
export const PAID_ENTITLEMENT_DAYS = 90;
export const TARGET_PUBLIC_DEALERS = 12;
export const TARGET_PRO_DEALERS = 4;
export const TARGET_STARTER_DEALERS = 8;
export const TARGET_LIVE_MIN = 150;
export const TARGET_LIVE_MAX = 180;
export const TARGET_SOLD_MIN = 40;
export const TARGET_SOLD_MAX = 60;
export const TARGET_EXPIRED_MIN = 10;
export const TARGET_EXPIRED_MAX = 15;
export const LIVE_COUNT = 165;
export const SOLD_COUNT = 50;
export const EXPIRED_COUNT = 12;
export const PENDING_COUNT = 3;
export const TAKEN_DOWN_COUNT = 2;
export const REJECTED_COUNT = 2;
export const DRAFT_COUNT = 1;
export const APPROVED_COUNT = 0;
export const STARTER_CAP_DEALER_LIVE = 10;
export const PRO_NEAR_CAP_LIVE = 28;

export const ACTIVE_LISTING_STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "LIVE",
] as const;

export const WIPE_DENYLIST = [
  "WaitlistUser",
  "ContentPage",
  "SiteSetting",
  "MonitoringIssue",
  "MonitoringIssueStatusEvent",
  "MonitoringEvent",
  "MonitoringAlertDelivery",
  "PaymentWebhookInbox",
  "RetentionLegalHold",
  "RetentionRun",
  "Region",
  "Category",
  "AttributeDefinition",
] as const;

export const WIPE_ORDER = [
  "DealerReviewModerationEvent",
  "DealerReview",
  "ListingStatusEvent",
  "ListingRevisionImage",
  "ListingRevisionAttributeValue",
  "ListingRevision",
  "Favourite",
  "SavedSearch",
  "ListingView",
  "Report",
  "Payment",
  "ListingImage",
  "ListingAttributeValue",
  "FreeListingClaim",
  "ListingImageUploadIntent",
  "ListingImageCleanupJob",
  "Listing",
  "DealerCancellationRequestEvent",
  "DealerCancellationRequest",
  "SubscriptionCharge",
  "Subscription",
  "PolicyAcceptance",
  "AccountDeletionJob",
  "AdminAuditLog",
  "DealerProfile",
  "User",
] as const;

export const WIPE_HOLD_ENTITY_TYPES = [
  "LISTING",
  "LISTING_VIEW",
  "REPORT",
  "DEALER_REVIEW",
] as const;

export const REPLAYABLE_INBOX_STATUSES = [
  "PENDING",
  "PROCESSING",
  "FAILED",
] as const;

export const BLOCKING_DELETION_JOB_STATUSES = [
  "REQUESTED",
  "PROCESSING",
  "FAILED",
] as const;

export const PRODUCTION_ENV_FILE_SUFFIX = ".env.production";
