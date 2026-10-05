import type { MappedArchiveListing } from "../dealer-stock-sync/map-listing";

export const DEALER_PACK_AUDIT_VERSION = 1 as const;
/** Legacy fixture ID for unit tests only. Real CLI must pass --backup-id. */
export const REQUIRED_BACKUP_ID = "pmr-2026-09-28T20-52-52-765Z-9bbd70";

export interface PackImageBaseline {
  id: string;
  publicId: string;
  order: number;
  provider: "CLOUDINARY" | "EXTERNAL" | "IMAGEKIT";
}

export interface PackListingBaseline {
  id: string;
  userId: string;
  dealerId: string | null;
  previewPackId: string | null;
  status: string;
  lifecycleRevision: number;
  photoRevision: number;
  updatedAt: string;
  images: PackImageBaseline[];
  revisions: Array<{ id: string; status: string; updatedAt: string }>;
}

export interface PackBaseline {
  packId: string;
  dealerProfileId: string;
  sourceRunId: string;
  enabled: boolean;
  updatedAt: string;
  listings: PackListingBaseline[];
}

export interface PlannedSourceImage {
  sourceUrl: string;
  localPath: string | null;
  checksum: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  order: number;
}

export interface PlannedListing {
  identityKey: string;
  sourceUrl: string | null;
  listing: MappedArchiveListing;
  images: PlannedSourceImage[];
  findings: string[];
}

export interface ExcludedListingEvidence {
  identityKey: string;
  sourceUrl: string | null;
  title: string | null;
  reasons: string[];
  findings: string[];
}

export interface ReplacePackAction {
  kind: "replace";
  dealerKey: string;
  displayName: string;
  sourceRunId: string;
  baseline: PackBaseline;
  listings: PlannedListing[];
  excludedListings: ExcludedListingEvidence[];
}

export interface DisablePackAction {
  kind: "disable";
  dealerKey: string;
  displayName: string;
  sourceRunId: string | null;
  baseline: PackBaseline;
  removeListings: boolean;
  reasons: string[];
  excludedListings: ExcludedListingEvidence[];
}

export type PackAuditAction = ReplacePackAction | DisablePackAction;

export interface PreviewLiveFinalization {
  candidateRunId: string;
  candidateFingerprint: string;
  liveReportRunId: string;
  liveReportPlanFingerprint: string;
  liveReportFingerprint: string;
  liveReportCreatedAt: string;
}

export interface PreviewPackAuditPlan {
  version: typeof DEALER_PACK_AUDIT_VERSION;
  runId: string;
  createdAt: string;
  target: {
    projectRef: string;
    confirmDb: string;
  };
  backupId: string;
  sourceRunId: string;
  adminUserId: string;
  actionCount: number;
  actions: PackAuditAction[];
  liveFinalization?: PreviewLiveFinalization;
  fingerprint: string;
}

export interface AppliedListingEvidence {
  identityKey: string;
  listingId: string;
  sourceUrls: string[];
  sourceChecksums: string[];
  publicIds: string[];
  finalImages: Array<{
    publicId: string;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number | null;
  }>;
}

export interface AppliedPackResult {
  dealerKey: string;
  action: PackAuditAction["kind"];
  status: "applied" | "failed";
  error?: string;
  listings?: AppliedListingEvidence[];
}

export interface PreviewPackApplyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  results: AppliedPackResult[];
}

export interface VerifiedPackResult {
  dealerKey: string;
  ok: boolean;
  errors: string[];
  listingCount: number;
  imageCount: number;
}

export interface PreviewPackVerifyReport {
  runId: string;
  planFingerprint: string;
  createdAt: string;
  ok: boolean;
  results: VerifiedPackResult[];
}
