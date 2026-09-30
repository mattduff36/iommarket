import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  insertPreviewListing,
  loadPreviewPackCatalog,
} from "../../lib/preview-packs/materialize";
import {
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
} from "../../lib/preview-packs/safety";
import {
  cleanupPreviewUploadedImages,
  enqueuePreviewUploadedImageCleanup,
  uploadPreviewPackImages,
  type PreviewUploadedImage,
} from "../../lib/preview-packs/upload";
import { assertBaselineMatches, capturePackBaseline, PACK_BASELINE_SELECT } from "./baseline";
import { assertNoRexDealerKey } from "./review-safety";
import {
  PREVIEW_REVIEW_LEDGER_ACTION,
  PREVIEW_REVIEW_LEDGER_ENTITY,
  type AppliedReviewListingEvidence,
  type AppliedReviewPackResult,
  type PlannedReviewListing,
  type PreviewReviewPlan,
  type ReviewPackAction,
} from "./review-types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reviewLedgerId(plan: PreviewReviewPlan, dealerKey: string) {
  return `${plan.runId}:${plan.fingerprint}:${dealerKey}`;
}

export function reviewUploadAttemptId(runId: string) {
  return `${runId}-${randomUUID()}`;
}

export function reviewListingsNeedingUpload(
  listings: PlannedReviewListing[],
  existingIdentities: Iterable<string>,
) {
  const existing = new Set(existingIdentities);
  return listings.filter((listing) => !existing.has(listing.identityKey));
}

function assertSyntheticOwner(owner: {
  isAdminPreview: boolean;
  user: { email: string; authUserId: string };
}) {
  if (
    !owner.isAdminPreview ||
    !isPreviewSystemEmail(owner.user.email) ||
    !isPreviewSystemAuthUserId(owner.user.authUserId)
  ) {
    throw new Error("Refusing review sync: replacement owner is not synthetic.");
  }
}

async function readReviewLedger(
  prisma: PrismaClient,
  plan: PreviewReviewPlan,
  dealerKey: string,
) {
  const row = await prisma.adminAuditLog.findFirst({
    where: {
      adminId: plan.adminUserId,
      action: PREVIEW_REVIEW_LEDGER_ACTION,
      entityType: PREVIEW_REVIEW_LEDGER_ENTITY,
      entityId: reviewLedgerId(plan, dealerKey),
    },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  return row?.details as unknown as AppliedReviewPackResult | null;
}

async function writeReviewLedger(
  tx: Prisma.TransactionClient,
  plan: PreviewReviewPlan,
  result: AppliedReviewPackResult,
) {
  await tx.adminAuditLog.create({
    data: {
      adminId: plan.adminUserId,
      action: PREVIEW_REVIEW_LEDGER_ACTION,
      entityType: PREVIEW_REVIEW_LEDGER_ENTITY,
      entityId: reviewLedgerId(plan, result.dealerKey),
      details: result as unknown as Prisma.InputJsonValue,
    },
  });
}

async function assertFrozenImage(image: PlannedReviewListing["images"][number]) {
  if (!image.localPath) {
    throw new Error("Frozen source image has no local archive path.");
  }
  const bytes = await readFile(image.localPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== image.checksum) {
    throw new Error(`Frozen source image checksum changed: ${image.sourceUrl}`);
  }
}

async function uploadReviewImages(action: ReviewPackAction, attemptId: string) {
  const allUploaded: PreviewUploadedImage[] = [];
  const byIdentity = new Map<string, PreviewUploadedImage[]>();
  try {
    for (const planned of action.listings) {
      if (planned.images.length === 0) {
        byIdentity.set(planned.identityKey, []);
        continue;
      }
      await Promise.all(planned.images.map(assertFrozenImage));
      const images = await uploadPreviewPackImages({
        dealerKey: action.dealerKey,
        identityKey: planned.identityKey,
        attemptId,
        sources: planned.images.map((image) => ({
          localPath: image.localPath,
          url: image.sourceUrl,
          order: image.order,
        })),
      });
      allUploaded.push(...images);
      byIdentity.set(planned.identityKey, images);
    }
    return { allUploaded, byIdentity };
  } catch (error) {
    await cleanupPreviewUploadedImages(allUploaded).catch(() => undefined);
    throw error;
  }
}

async function applyReviewPack(input: {
  prisma: PrismaClient;
  plan: PreviewReviewPlan;
  action: ReviewPackAction;
  catalog: Awaited<ReturnType<typeof loadPreviewPackCatalog>>;
}): Promise<AppliedReviewPackResult> {
  assertNoRexDealerKey(input.action.dealerKey);
  const existing = await input.prisma.listing.findMany({
    where: {
      previewPackId: input.action.baseline.packId,
      status: "ADMIN_PREVIEW",
      reviewSourceIdentity: {
        in: input.action.listings.map((listing) => listing.identityKey),
      },
    },
    select: { reviewSourceIdentity: true },
  });
  const existingIdentities = new Set(
    existing
      .map((listing) => listing.reviewSourceIdentity)
      .filter((identity): identity is string => Boolean(identity)),
  );
  const uploadAction = {
    ...input.action,
    listings: reviewListingsNeedingUpload(input.action.listings, existingIdentities),
  };
  const uploaded = await uploadReviewImages(
    uploadAction,
    reviewUploadAttemptId(input.plan.runId),
  );
  const evidence: AppliedReviewListingEvidence[] = [];
  const unusedUploaded: PreviewUploadedImage[] = [];
  try {
    await input.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.action.baseline.packId}))`;
      const current = await tx.dealerPreviewPack.findUnique({
        where: { id: input.action.baseline.packId },
        select: {
          ...PACK_BASELINE_SELECT,
          enabled: true,
          dealerKey: true,
          listings: {
            ...PACK_BASELINE_SELECT.listings,
            where: { reviewSourceIdentity: null },
          },
          dealerProfile: {
            select: {
              isAdminPreview: true,
              userId: true,
              user: { select: { email: true, authUserId: true } },
            },
          },
        },
      });
      if (!current) throw new Error("Refusing review sync: preview pack disappeared.");
      if (current.dealerKey !== input.action.dealerKey) {
        throw new Error("Refusing review sync: pack dealer key mismatch.");
      }
      assertSyntheticOwner(current.dealerProfile);
      assertBaselineMatches(input.action.baseline, capturePackBaseline(current), {
        ignorePackEnabledAndUpdatedAt: true,
      });
      if (current.enabled !== input.action.keepEnabled) {
        throw new Error(
          `Refusing review sync: pack enabled state changed for ${input.action.dealerKey}.`,
        );
      }
      await tx.dealerPreviewPack.update({
        where: { id: current.id },
        data: {
          reviewState: "NEEDS_REVIEW",
          reviewReasons: input.action.reviewReasons,
          reviewSourceRunId: input.action.reviewSourceRunId,
        },
      });
      const owners = {
        userId: current.dealerProfile.userId,
        dealerId: current.dealerProfileId,
      };
      for (const planned of input.action.listings) {
        const existing = await tx.listing.findFirst({
          where: {
            previewPackId: current.id,
            dealerId: owners.dealerId,
            status: "ADMIN_PREVIEW",
            reviewSourceIdentity: planned.identityKey,
          },
          select: { id: true, images: { select: { id: true } } },
        });
        if (existing) {
          unusedUploaded.push(...(uploaded.byIdentity.get(planned.identityKey) ?? []));
          evidence.push({
            identityKey: planned.identityKey,
            listingId: existing.id,
            imageCount: existing.images.length,
            reused: true,
          });
          continue;
        }
        const images = uploaded.byIdentity.get(planned.identityKey) ?? [];
        const listingId = await insertPreviewListing(tx, {
          ...owners,
          previewPackId: current.id,
          dealerKey: input.action.dealerKey,
          sourceRunId: input.action.packSourceRunId,
          identityKey: planned.identityKey,
          listing: planned.listing,
          images,
          catalog: input.catalog,
          allowEmptyImages: true,
          review: {
            state: "NEEDS_REVIEW",
            reasons: planned.reasons,
            sourceIdentity: planned.identityKey,
            sourceUrl: planned.sourceUrl,
          },
        });
        if (!listingId) {
          throw new Error(`Review listing insert failed for ${planned.identityKey}.`);
        }
        evidence.push({
          identityKey: planned.identityKey,
          listingId,
          imageCount: images.length,
          reused: false,
        });
      }
      const stillEnabled = await tx.dealerPreviewPack.findUnique({
        where: { id: current.id },
        select: { enabled: true },
      });
      if (stillEnabled?.enabled !== input.action.keepEnabled) {
        throw new Error("Refusing review sync: apply must not change pack enabled state.");
      }
      if (unusedUploaded.length > 0) {
        await enqueuePreviewUploadedImageCleanup(
          tx,
          unusedUploaded,
          `preview-review-race-unused:${input.plan.runId}:${input.action.dealerKey}`,
        );
      }
      await writeReviewLedger(tx, input.plan, {
        dealerKey: input.action.dealerKey,
        status: "applied",
        keepEnabled: input.action.keepEnabled,
        listingCount: evidence.length,
        listings: evidence,
      });
    }, { timeout: 300_000 });
    return {
      dealerKey: input.action.dealerKey,
      status: "applied",
      keepEnabled: input.action.keepEnabled,
      listingCount: evidence.length,
      listings: evidence,
    };
  } catch (error) {
    const committed = await readReviewLedger(
      input.prisma,
      input.plan,
      input.action.dealerKey,
    ).catch(() => null);
    if (committed) return committed;
    await enqueuePreviewUploadedImageCleanup(
      input.prisma,
      uploaded.allUploaded,
      `preview-review-transaction-uncertain:${input.plan.runId}:${input.action.dealerKey}`,
    ).catch(() => undefined);
    throw error;
  }
}

export async function applyPreviewReviewPlan(input: {
  prisma: PrismaClient;
  plan: PreviewReviewPlan;
}) {
  const results: AppliedReviewPackResult[] = [];
  const catalog = await loadPreviewPackCatalog(input.prisma);
  for (const action of input.plan.actions) {
    try {
      assertNoRexDealerKey(action.dealerKey);
      const recovered = await readReviewLedger(input.prisma, input.plan, action.dealerKey);
      if (recovered) {
        results.push(recovered);
        continue;
      }
      results.push(await applyReviewPack({
        prisma: input.prisma,
        plan: input.plan,
        action,
        catalog,
      }));
    } catch (error) {
      results.push({
        dealerKey: action.dealerKey,
        status: "failed",
        error: errorMessage(error),
        keepEnabled: action.keepEnabled,
        listingCount: 0,
      });
    }
  }
  return results;
}
