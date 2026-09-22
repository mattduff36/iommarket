export const DATASET_VERSION = "PREVIEW-SAMPLE-A7C3E91F";
export const PLACEHOLDER_AUTH_RE = /^00000000-0000-0000-0000-/;
export const SEED_PAYMENT_NAMESPACE = "seed:demo:";
export const PAID_ENTITLEMENT_DAYS = 90;
export const TARGET_PUBLIC_DEALERS = 12;
export const TARGET_PRIVATE_SELLERS = 22;
export const TARGET_PRO_DEALERS = 4;
export const TARGET_STARTER_DEALERS = 8;
export const TARGET_LIVE_MIN = 150;
export const TARGET_LIVE_MAX = 170;
export const TARGET_SOLD_MIN = 90;
export const TARGET_SOLD_MAX = 120;
export const TARGET_EXPIRED_MIN = 20;
export const TARGET_EXPIRED_MAX = 30;
export const LIVE_COUNT = 160;
export const SOLD_COUNT = 105;
export const EXPIRED_COUNT = 24;
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
  "VehicleMake",
  "VehicleModel",
  "VehicleModelAlias",
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
  "DealerPreviewPack",
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
