import type { PrismaClient } from "@prisma/client";
import { registryGroupKey } from "../../lib/preview-packs/archive";
import {
  isArchivedPreviewDealerKey,
  isExcludedPreviewDealerKey,
} from "../../lib/preview-packs/safety";
import { canonicalJson } from "./plan-file";
import {
  PREVIEW_REVIEW_LEDGER_ACTION,
  PREVIEW_REVIEW_LEDGER_ENTITY,
  CANONICAL_NON_REX_PACK_COUNT,
  type PreviewReviewApplyReport,
  type PreviewReviewPlan,
  type PreviewReviewVerifyReport,
  type VerifiedReviewPackResult,
} from "./review-types";

export async function verifyPreviewReviewPlan(input: {
  prisma: PrismaClient;
  plan: PreviewReviewPlan;
  applyReport: PreviewReviewApplyReport | null;
}): Promise<PreviewReviewVerifyReport> {
  if (
    input.applyReport &&
    (input.applyReport.runId !== input.plan.runId ||
      input.applyReport.planFingerprint !== input.plan.fingerprint)
  ) {
    throw new Error("Refusing review verification: apply report does not match the plan.");
  }
  const appliedByDealer = new Map(
    (input.applyReport?.results ?? []).map((result) => [result.dealerKey, result]),
  );
  const results: VerifiedReviewPackResult[] = [];
  for (const action of input.plan.actions) {
    const errors: string[] = [];
    if (isArchivedPreviewDealerKey(action.dealerKey)) {
      errors.push("rex-must-remain-excluded");
    }
    const durable = await input.prisma.adminAuditLog.findFirst({
      where: {
        adminId: input.plan.adminUserId,
        action: PREVIEW_REVIEW_LEDGER_ACTION,
        entityType: PREVIEW_REVIEW_LEDGER_ENTITY,
        entityId: `${input.plan.runId}:${input.plan.fingerprint}:${action.dealerKey}`,
      },
      orderBy: { createdAt: "desc" },
      select: { details: true },
    });
    const live = await input.prisma.dealerPreviewPack.findUnique({
      where: { id: action.baseline.packId },
      select: {
        enabled: true,
        reviewState: true,
        reviewSourceRunId: true,
        listings: {
          where: { reviewState: "NEEDS_REVIEW" },
          select: {
            id: true,
            status: true,
            reviewSourceIdentity: true,
            images: { select: { id: true, publicId: true } },
          },
        },
      },
    });
    if (!live) errors.push("pack-missing");
    if (live && live.enabled !== action.keepEnabled) {
      errors.push("pack-enabled-changed");
    }
    if (live && action.keepEnabled === false && live.enabled) {
      errors.push("disabled-pack-was-enabled");
    }
    if (live && live.reviewState !== "NEEDS_REVIEW") {
      errors.push("pack-review-state");
    }
    if (live && live.reviewSourceRunId !== action.reviewSourceRunId) {
      errors.push("pack-review-source-run");
    }
    const liveIdentities = new Set(
      (live?.listings ?? [])
        .map((listing) => listing.reviewSourceIdentity)
        .filter((value): value is string => Boolean(value)),
    );
    for (const listing of action.listings) {
      if (!liveIdentities.has(listing.identityKey)) {
        errors.push(`missing-review-listing:${listing.identityKey}`);
      }
      const liveListing = live?.listings.find(
        (candidate) => candidate.reviewSourceIdentity === listing.identityKey,
      );
      if (liveListing && liveListing.status !== "ADMIN_PREVIEW") {
        errors.push(`review-listing-status:${listing.identityKey}:${liveListing.status}`);
      }
      const appliedListing = appliedByDealer
        .get(action.dealerKey)
        ?.listings?.find((candidate) => candidate.identityKey === listing.identityKey);
      if (
        liveListing &&
        appliedListing &&
        liveListing.images.length !== appliedListing.imageCount
      ) {
        errors.push(`review-listing-image-count:${listing.identityKey}`);
      }
    }
    if ((live?.listings.length ?? 0) !== action.listings.length) {
      errors.push("review-listing-count");
    }
    if (
      !durable?.details ||
      canonicalJson(durable.details) !== canonicalJson(appliedByDealer.get(action.dealerKey))
    ) {
      errors.push("durable-apply-evidence");
    }
    results.push({
      dealerKey: action.dealerKey,
      ok: errors.length === 0,
      errors,
      listingCount: live?.listings.length ?? 0,
      zeroImageCount: (live?.listings ?? []).filter((listing) => listing.images.length === 0).length,
      enabled: live?.enabled ?? false,
    });
  }
  const listingCount = results.reduce((count, result) => count + result.listingCount, 0);
  if (listingCount !== input.plan.listingCount) {
    results.push({
      dealerKey: "__totals__",
      ok: false,
      errors: [`review-listing-total:${listingCount}`],
      listingCount,
      zeroImageCount: 0,
      enabled: false,
    });
  }
  const allPacks = await input.prisma.dealerPreviewPack.findMany({
    orderBy: { displayName: "asc" },
    select: {
      dealerKey: true,
      displayName: true,
      enabled: true,
      reviewState: true,
      reviewReasons: true,
      listings: {
        select: {
          reviewState: true,
          images: { take: 1, select: { id: true } },
        },
      },
    },
  });
  const packCensus = allPacks
    .filter(
      (pack) =>
        !isArchivedPreviewDealerKey(pack.dealerKey) &&
        !isExcludedPreviewDealerKey(pack.dealerKey, registryGroupKey(pack.dealerKey)),
    )
    .map((pack) => {
      const reviewListings = pack.listings.filter(
        (listing) => listing.reviewState === "NEEDS_REVIEW",
      );
      return {
        dealerKey: pack.dealerKey,
        displayName: pack.displayName,
        enabled: pack.enabled,
        reviewState: pack.reviewState,
        reviewReasons: pack.reviewReasons,
        listingCount: pack.listings.length,
        reviewListingCount: reviewListings.length,
        zeroImageReviewCount: reviewListings.filter(
          (listing) => listing.images.length === 0,
        ).length,
      };
    });
  const packCensusErrors: string[] = [];
  if (packCensus.length !== CANONICAL_NON_REX_PACK_COUNT) {
    packCensusErrors.push(
      `pack-count:${packCensus.length}:expected:${CANONICAL_NON_REX_PACK_COUNT}`,
    );
  }
  if (allPacks.some((pack) => isArchivedPreviewDealerKey(pack.dealerKey))) {
    packCensusErrors.push("rex-pack-present");
  }
  return {
    runId: input.plan.runId,
    planFingerprint: input.plan.fingerprint,
    createdAt: new Date().toISOString(),
    ok: results.every((result) => result.ok) && packCensusErrors.length === 0,
    listingCount,
    results,
    packCount: packCensus.length,
    packCensusErrors,
    packCensus,
  };
}
