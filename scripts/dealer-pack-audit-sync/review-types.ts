import type { MappedArchiveListing } from "../dealer-stock-sync/map-listing";
import type { PackBaseline, PlannedSourceImage } from "./types";

export const DEALER_PACK_REVIEW_VERSION = 1 as const;
export const CANONICAL_REVIEW_LISTING_COUNT = 164;
export const CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT = 106;
export const CANONICAL_NON_REX_PACK_COUNT = 35;
export const CANONICAL_REVIEW_SOURCE_RUN_ID = "2026-09-30T06-48-46-733Z";
export const CANONICAL_AUDIT_PLAN_RELATIVE =
  "private/dealer-pack-audit/correct-dealer-audit-post-review-final-v3-2026-09-30/preview-plan.json";
export const PACK_UNVERIFIED_IDENTITY = "pack-unverified";
export const PREVIEW_REVIEW_LEDGER_ACTION = "DEALER_PACK_PREVIEW_REVIEW_APPLY";
export const PREVIEW_REVIEW_LEDGER_ENTITY = "DealerPreviewPackReview";

export interface PlannedReviewListing {
  identityKey: string;
  snapshotIdentityKey: string;
  sourceUrl: string | null;
  title: string | null;
  reasons: string[];
  findings: string[];
  listing: MappedArchiveListing;
  images: PlannedSourceImage[];
}

export interface ReviewPackAction {
  dealerKey: string;
  displayName: string;
  keepEnabled: boolean;
  packSourceRunId: string;
  reviewSourceRunId: string;
  reviewReasons: string[];
  baseline: PackBaseline;
  listings: PlannedReviewListing[];
}

export interface PreviewReviewPlan {
  version: typeof DEALER_PACK_REVIEW_VERSION;
  kind: "preview-review";
  runId: string;
  createdAt: string;
  target: {
    projectRef: string;
    confirmDb: string;
  };
  backupId: string;
  sourceRunId: string;
  auditPlanPath: string;
  auditPlanFingerprint: string;
  adminUserId: string;
  actionCount: number;
  listingCount: number;
  unclassifiedImportableCount: number;
  actions: ReviewPackAction[];
  fingerprint: string;
}

export interface AppliedReviewListingEvidence {
  identityKey: string;
  listingId: string;
  imageCount: number;
  reused: boolean;
}

export interface AppliedReviewPackResult {
  dealerKey: string;
  status: "applied" | "failed";
  error?: string;
  keepEnabled: boolean;
  listingCount: number;
  listings?: AppliedReviewListingEvidence[];
}

export interface PreviewReviewApplyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  results: AppliedReviewPackResult[];
}

export interface VerifiedReviewPackResult {
  dealerKey: string;
  ok: boolean;
  errors: string[];
  listingCount: number;
  zeroImageCount: number;
  enabled: boolean;
}

export interface PreviewReviewVerifyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  ok: boolean;
  listingCount: number;
  results: VerifiedReviewPackResult[];
  packCount: number;
  packCensusErrors: string[];
  packCensus: Array<{
    dealerKey: string;
    displayName: string;
    enabled: boolean;
    reviewState: "NONE" | "NEEDS_REVIEW";
    reviewReasons: string[];
    listingCount: number;
    reviewListingCount: number;
    zeroImageReviewCount: number;
  }>;
}
