import type { PrismaClient } from "@prisma/client";
import { verifyExactPackState } from "./exact";
import { canonicalJson } from "./plan-file";
import type {
  PreviewPackApplyReport,
  PreviewPackAuditPlan,
  PreviewPackVerifyReport,
} from "./types";

export async function verifyPreviewPackAuditPlan(input: {
  prisma: PrismaClient;
  plan: PreviewPackAuditPlan;
  applyReport: PreviewPackApplyReport | null;
}): Promise<PreviewPackVerifyReport> {
  if (
    input.applyReport &&
    (input.applyReport.runId !== input.plan.runId ||
      input.applyReport.planFingerprint !== input.plan.fingerprint)
  ) {
    throw new Error("Refusing audit verification: apply report does not match the plan.");
  }
  const appliedByDealer = new Map(
    (input.applyReport?.results ?? []).map((result) => [result.dealerKey, result]),
  );
  const results = [];
  for (const action of input.plan.actions) {
    const durable = await input.prisma.adminAuditLog.findFirst({
      where: {
        adminId: input.plan.adminUserId,
        action: "DEALER_PACK_PREVIEW_APPLY",
        entityType: "DealerPreviewPackAudit",
        entityId: `${input.plan.runId}:${input.plan.fingerprint}:${action.dealerKey}`,
      },
      orderBy: { createdAt: "desc" },
      select: { details: true },
    });
    const live = await input.prisma.dealerPreviewPack.findUnique({
      where: { id: action.baseline.packId },
      select: {
        dealerProfileId: true,
        sourceRunId: true,
        enabled: true,
        listings: {
          select: {
            id: true,
            dealerId: true,
            title: true,
            description: true,
            price: true,
            status: true,
            category: { select: { slug: true } },
            attributeValues: {
              select: {
                value: true,
                attributeDefinition: { select: { slug: true } },
              },
            },
            images: {
              orderBy: { order: "asc" },
              select: {
                publicId: true,
                assetId: true,
                order: true,
                width: true,
                height: true,
                format: true,
                bytes: true,
              },
            },
          },
        },
      },
    });
    const errors = verifyExactPackState({
      action,
      applied: appliedByDealer.get(action.dealerKey),
      live,
    });
    const expectedCleanup = [...new Set(
      action.baseline.listings.flatMap((listing) =>
        listing.images
          .filter((image) =>
            image.provider === "CLOUDINARY" &&
            image.publicId.startsWith("iommarket/listings/preview-packs/"))
          .map((image) => image.publicId)),
    )];
    if (expectedCleanup.length > 0) {
      const queued = await input.prisma.listingImageCleanupJob.findMany({
        where: {
          publicId: { in: expectedCleanup },
          reason: `dealer-pack-exact-sync:${action.dealerKey}`,
        },
        select: { publicId: true },
      });
      const queuedIds = new Set(queued.map((job) => job.publicId));
      if (expectedCleanup.some((publicId) => !queuedIds.has(publicId))) {
        errors.push("owned-image-cleanup-not-queued");
      }
    }
    if (
      !durable?.details ||
      canonicalJson(durable.details) !==
        canonicalJson(appliedByDealer.get(action.dealerKey))
    ) {
      errors.push("durable-apply-evidence");
    }
    results.push({
      dealerKey: action.dealerKey,
      ok: errors.length === 0,
      errors,
      listingCount: live?.listings.length ?? 0,
      imageCount:
        live?.listings.reduce((count, listing) => count + listing.images.length, 0) ??
        0,
    });
  }
  return {
    runId: input.plan.runId,
    planFingerprint: input.plan.fingerprint,
    createdAt: new Date().toISOString(),
    ok: results.every((result) => result.ok),
    results,
  };
}
