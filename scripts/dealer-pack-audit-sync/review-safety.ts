import { isArchivedPreviewDealerKey } from "../../lib/preview-packs/safety";
import { parseArgValue } from "../prod-mirror/safety";
import { PRODUCTION_PROJECT_REF } from "../wipe-preview-marketplace/target";
import { planFingerprint } from "./plan-file";
import {
  CANONICAL_REVIEW_LISTING_COUNT,
  CANONICAL_REVIEW_SOURCE_RUN_ID,
  CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
  PACK_UNVERIFIED_IDENTITY,
  type PreviewReviewPlan,
} from "./review-types";
import {
  assertPreviewBinding,
  isSafeBackupId,
  PREVIEW_CONFIRM_DB,
  requireBackupId,
} from "./safety";
import { PREVIEW_PROJECT_REF } from "../wipe-preview-marketplace/target";

export const REVIEW_APPLY_CONFIRM_PHRASE =
  `yes restore preview pack review listings ${PREVIEW_PROJECT_REF}`;

export function assertCanonicalReviewSourceRun(sourceRunId: string) {
  if (sourceRunId !== CANONICAL_REVIEW_SOURCE_RUN_ID) {
    throw new Error(
      `Refusing review sync: source run must be ${CANONICAL_REVIEW_SOURCE_RUN_ID}.`,
    );
  }
}

export function assertNoRexDealerKey(dealerKey: string, prefix = "Refusing review sync") {
  if (isArchivedPreviewDealerKey(dealerKey)) {
    throw new Error(`${prefix}: Rex is archived and must not be reconstructed.`);
  }
}

export function assertReviewCounts(input: {
  listingCount: number;
  unclassifiedImportableCount: number;
  expectedListingCount?: number;
  expectedUnclassifiedCount?: number;
}) {
  const expectedListings = input.expectedListingCount ?? CANONICAL_REVIEW_LISTING_COUNT;
  if (input.listingCount !== expectedListings) {
    throw new Error(
      `Refusing review sync: expected ${expectedListings} review listings, got ${input.listingCount}.`,
    );
  }
  if (
    input.expectedUnclassifiedCount != null &&
    input.unclassifiedImportableCount !== input.expectedUnclassifiedCount
  ) {
    throw new Error(
      `Refusing review sync: expected ${input.expectedUnclassifiedCount} unclassified importable leftovers, got ${input.unclassifiedImportableCount}.`,
    );
  }
}

export function sealReviewPlan(
  plan: Omit<PreviewReviewPlan, "fingerprint">,
): PreviewReviewPlan {
  return { ...plan, fingerprint: planFingerprint(plan) };
}

export function assertReviewPlanIntegrity(plan: PreviewReviewPlan) {
  if (plan.kind !== "preview-review" || plan.version !== 1) {
    throw new Error("Refusing review sync: frozen plan kind/version is invalid.");
  }
  if (typeof plan.backupId !== "string" || !plan.backupId.trim() || !isSafeBackupId(plan.backupId)) {
    throw new Error("Refusing review sync: frozen plan backup ID is invalid.");
  }
  assertCanonicalReviewSourceRun(plan.sourceRunId);
  if (plan.actionCount !== plan.actions.length) {
    throw new Error("Refusing review sync: frozen plan action count is invalid.");
  }
  const listingCount = plan.actions.reduce(
    (count, action) => count + action.listings.length,
    0,
  );
  if (plan.listingCount !== listingCount) {
    throw new Error("Refusing review sync: frozen plan listing count is invalid.");
  }
  assertReviewCounts({
    listingCount,
    unclassifiedImportableCount: plan.unclassifiedImportableCount,
    expectedUnclassifiedCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
  });
  for (const action of plan.actions) {
    assertNoRexDealerKey(action.dealerKey);
    if (action.keepEnabled !== action.baseline.enabled) {
      throw new Error(
        `Refusing review sync: keepEnabled drifted for ${action.dealerKey}.`,
      );
    }
    if (action.listings.some((listing) => listing.identityKey === PACK_UNVERIFIED_IDENTITY)) {
      throw new Error("Refusing review sync: pack-unverified placeholder leaked into listings.");
    }
  }
  if (planFingerprint(plan) !== plan.fingerprint) {
    throw new Error("Refusing review sync: frozen plan fingerprint is invalid.");
  }
}

export function assertReviewApplySafety(input: {
  argv: string[];
  plan: PreviewReviewPlan;
  databaseUrl: string | undefined;
}) {
  if (parseArgValue(input.argv, "production-ref") || parseArgValue(input.argv, "dest-ref")) {
    throw new Error("Refusing review sync: production flags are not allowed.");
  }
  if ((input.databaseUrl ?? "").toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
    throw new Error("Refusing review sync: production database URL is not allowed.");
  }
  assertPreviewBinding({
    databaseUrl: input.databaseUrl,
    projectRef: parseArgValue(input.argv, "preview-ref") ?? "",
    confirmDb: parseArgValue(input.argv, "confirm-db") ?? "",
  });
  if (parseArgValue(input.argv, "allow") !== "1") {
    throw new Error("Refusing review sync: --allow=1 is required.");
  }
  const cliBackupId = requireBackupId(parseArgValue(input.argv, "backup-id"), "Refusing review sync");
  if (cliBackupId !== input.plan.backupId) {
    throw new Error("Refusing review sync: --backup-id does not match the frozen plan.");
  }
  if (parseArgValue(input.argv, "plan-fingerprint") !== input.plan.fingerprint) {
    throw new Error("Refusing review sync: --plan-fingerprint mismatch.");
  }
  if (parseArgValue(input.argv, "plan-count") !== String(input.plan.actionCount)) {
    throw new Error("Refusing review sync: --plan-count mismatch.");
  }
  if (parseArgValue(input.argv, "confirm") !== REVIEW_APPLY_CONFIRM_PHRASE) {
    throw new Error(`Refusing review sync: --confirm must be "${REVIEW_APPLY_CONFIRM_PHRASE}".`);
  }
  if (
    input.plan.target.projectRef !== PREVIEW_PROJECT_REF ||
    input.plan.target.confirmDb !== PREVIEW_CONFIRM_DB
  ) {
    throw new Error("Refusing review sync: frozen plan target mismatch.");
  }
  assertReviewPlanIntegrity(input.plan);
}
