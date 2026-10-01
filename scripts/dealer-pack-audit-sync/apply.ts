import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import {
  insertPreviewListing,
  loadPreviewPackCatalog,
} from "../../lib/preview-packs/materialize";
import {
  cleanupPreviewUploadedImages,
  uploadPreviewPackImages,
  type PreviewUploadedImage,
} from "../../lib/preview-packs/upload";
import {
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
} from "../../lib/preview-packs/safety";
import {
  assertBaselineMatches,
  capturePackBaseline,
  PACK_BASELINE_SELECT,
} from "./baseline";
import type {
  AppliedListingEvidence,
  AppliedPackResult,
  PackAuditAction,
  PlannedListing,
  PreviewPackAuditPlan,
} from "./types";

const OWNED_PREVIEW_PREFIX = `${IMAGE_CONSTRAINTS.folder}/preview-packs/`;
const PREVIEW_LEDGER_ACTION = "DEALER_PACK_PREVIEW_APPLY";
const PREVIEW_LEDGER_ENTITY = "DealerPreviewPackAudit";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function previewLedgerId(plan: PreviewPackAuditPlan, dealerKey: string) {
  return `${plan.runId}:${plan.fingerprint}:${dealerKey}`;
}

async function readPreviewLedger(
  prisma: PrismaClient,
  plan: PreviewPackAuditPlan,
  action: PackAuditAction,
) {
  const row = await prisma.adminAuditLog.findFirst({
    where: {
      adminId: plan.adminUserId,
      action: PREVIEW_LEDGER_ACTION,
      entityType: PREVIEW_LEDGER_ENTITY,
      entityId: previewLedgerId(plan, action.dealerKey),
    },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  return row?.details as unknown as AppliedPackResult | null;
}

async function writePreviewLedger(
  tx: Prisma.TransactionClient,
  plan: PreviewPackAuditPlan,
  result: AppliedPackResult,
) {
  await tx.adminAuditLog.create({
    data: {
      adminId: plan.adminUserId,
      action: PREVIEW_LEDGER_ACTION,
      entityType: PREVIEW_LEDGER_ENTITY,
      entityId: previewLedgerId(plan, result.dealerKey),
      details: result as unknown as Prisma.InputJsonValue,
    },
  });
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
    throw new Error("Refusing audit sync: replacement owner is not synthetic.");
  }
}

export function assertPackListingOwnership(
  action: PackAuditAction,
  owners: { userId: string; dealerId: string },
) {
  const invalid = action.baseline.listings.find((listing) =>
    listing.userId !== owners.userId ||
    listing.dealerId !== owners.dealerId ||
    listing.previewPackId !== action.baseline.packId ||
    listing.status !== "ADMIN_PREVIEW");
  if (invalid) {
    throw new Error(
      `Refusing audit sync: preview listing ownership mismatch (${invalid.id}).`,
    );
  }
}

async function stagePackDisabled(
  prisma: PrismaClient,
  action: PackAuditAction,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${action.baseline.packId}))`;
    const current = await tx.dealerPreviewPack.findUnique({
        where: { id: action.baseline.packId },
        select: {
          ...PACK_BASELINE_SELECT,
          dealerProfile: {
            select: {
              isAdminPreview: true,
              userId: true,
              user: { select: { email: true, authUserId: true } },
            },
          },
        },
    });
    if (!current) throw new Error("Refusing audit sync: preview pack disappeared.");
    const captured = capturePackBaseline(current);
    try {
      assertBaselineMatches(action.baseline, captured);
    } catch (error) {
      assertBaselineMatches(action.baseline, captured, {
        ignorePackEnabledAndUpdatedAt: true,
      });
    }
    if (action.kind === "replace" || action.removeListings) {
      assertSyntheticOwner(current.dealerProfile);
      assertPackListingOwnership(action, {
        userId: current.dealerProfile.userId,
        dealerId: current.dealerProfileId,
      });
    }
    if (action.kind === "replace" && current.enabled) {
      await tx.dealerPreviewPack.update({
        where: { id: current.id },
        data: { enabled: false },
      });
    }
    return {
      dealerId: current.dealerProfileId,
      userId: current.dealerProfile.userId,
    };
  }, { timeout: 60_000 });
}

async function assertFrozenImage(image: PlannedListing["images"][number]) {
  if (!image.localPath) {
    throw new Error("Frozen source image has no local archive path.");
  }
  const bytes = await readFile(image.localPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== image.checksum) {
    throw new Error(`Frozen source image checksum changed: ${image.sourceUrl}`);
  }
}

export function assertReplaceListingsHaveImages(
  action: Extract<PackAuditAction, { kind: "replace" }>,
) {
  const empty = action.listings.find((listing) => listing.images.length === 0);
  if (empty) {
    throw new Error(
      `Refusing audit sync: listing has no valid source image (${empty.identityKey}).`,
    );
  }
}

async function uploadReplacement(action: Extract<PackAuditAction, { kind: "replace" }>) {
  assertReplaceListingsHaveImages(action);
  const allUploaded: PreviewUploadedImage[] = [];
  const byIdentity = new Map<string, PreviewUploadedImage[]>();
  try {
    for (const planned of action.listings) {
      await Promise.all(planned.images.map(assertFrozenImage));
      const images = await uploadPreviewPackImages({
        dealerKey: action.dealerKey,
        identityKey: planned.identityKey,
        attemptId: `${action.sourceRunId}-${randomUUID()}`,
        sources: planned.images.map((image) => ({
          localPath: image.localPath,
          url: image.sourceUrl,
          order: image.order,
        })),
      });
      allUploaded.push(...images);
      if (
        images.length !== planned.images.length ||
        images.some((image, index) => image.order !== planned.images[index]?.order)
      ) {
        throw new Error(`Not every image uploaded for ${planned.identityKey}.`);
      }
      byIdentity.set(planned.identityKey, images);
    }
    return { allUploaded, byIdentity };
  } catch (error) {
    await cleanupPreviewUploadedImages(allUploaded).catch(() => undefined);
    throw error;
  }
}

async function enqueueOldOwnedImages(
  tx: Prisma.TransactionClient,
  action: PackAuditAction,
) {
  const publicIds = [...new Set(
    action.baseline.listings.flatMap((listing) =>
      listing.images
        .filter((image) => image.provider === "CLOUDINARY")
        .map((image) => image.publicId)
        .filter((publicId) => publicId.startsWith(OWNED_PREVIEW_PREFIX)),
    ),
  )];
  if (publicIds.length === 0) return;
  await tx.listingImageCleanupJob.createMany({
    data: publicIds.map((publicId) => ({
      publicId,
      deliveryType: "private",
      reason: `dealer-pack-exact-sync:${action.dealerKey}`,
    })),
  });
}

async function assertCurrentBaseline(
  tx: Prisma.TransactionClient,
  action: PackAuditAction,
) {
  const current = await tx.dealerPreviewPack.findUnique({
    where: { id: action.baseline.packId },
    select: {
      ...PACK_BASELINE_SELECT,
      dealerProfile: {
        select: {
          isAdminPreview: true,
          userId: true,
          user: { select: { email: true, authUserId: true } },
        },
      },
    },
  });
  if (!current) throw new Error("Refusing audit sync: staged preview pack disappeared.");
  const captured = capturePackBaseline(current);
  assertBaselineMatches(action.baseline, captured, {
    ignorePackEnabledAndUpdatedAt: true,
  });
  if (action.kind === "replace" || action.removeListings) {
    assertSyntheticOwner(current.dealerProfile);
    assertPackListingOwnership(action, {
      userId: current.dealerProfile.userId,
      dealerId: current.dealerProfileId,
    });
  }
}

async function applyDisable(
  prisma: PrismaClient,
  action: Extract<PackAuditAction, { kind: "disable" }>,
  plan: PreviewPackAuditPlan,
  owners: { userId: string; dealerId: string },
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${action.baseline.packId}))`;
    await assertCurrentBaseline(tx, action);
    await tx.dealerPreviewPack.update({
      where: { id: action.baseline.packId },
      data: { enabled: false },
    });
    if (action.removeListings) {
      await enqueueOldOwnedImages(tx, action);
      const deleted = await tx.listing.deleteMany({
        where: {
          previewPackId: action.baseline.packId,
          userId: owners.userId,
          dealerId: owners.dealerId,
          status: "ADMIN_PREVIEW",
        },
      });
      if (deleted.count !== action.baseline.listings.length) {
        throw new Error("Refusing audit sync: preview disable deletion count mismatch.");
      }
    }
    await writePreviewLedger(tx, plan, {
      dealerKey: action.dealerKey,
      action: action.kind,
      status: "applied",
    });
  }, { timeout: 60_000 });
}

async function applyReplace(input: {
  prisma: PrismaClient;
  action: Extract<PackAuditAction, { kind: "replace" }>;
  owners: { userId: string; dealerId: string };
  catalog: Awaited<ReturnType<typeof loadPreviewPackCatalog>>;
  plan: PreviewPackAuditPlan;
}) {
  assertReplaceListingsHaveImages(input.action);
  const uploaded = await uploadReplacement(input.action);
  const evidence: AppliedListingEvidence[] = [];
  try {
    await input.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.action.baseline.packId}))`;
      await assertCurrentBaseline(tx, input.action);
      await tx.dealerPreviewPack.update({
        where: { id: input.action.baseline.packId },
        data: { enabled: false },
      });
      await enqueueOldOwnedImages(tx, input.action);
      const deleted = await tx.listing.deleteMany({
        where: {
          previewPackId: input.action.baseline.packId,
          userId: input.owners.userId,
          dealerId: input.owners.dealerId,
          status: "ADMIN_PREVIEW",
        },
      });
      if (deleted.count !== input.action.baseline.listings.length) {
        throw new Error("Refusing audit sync: preview replacement deletion count mismatch.");
      }
      await tx.dealerPreviewPack.update({
        where: { id: input.action.baseline.packId },
        data: {
          sourceRunId: input.action.sourceRunId,
          displayName: input.action.displayName,
          enabled: false,
        },
      });
      for (const planned of input.action.listings) {
        if (planned.images.length === 0) {
          throw new Error(
            `Refusing audit sync: listing has no valid source image (${planned.identityKey}).`,
          );
        }
        const images = uploaded.byIdentity.get(planned.identityKey) ?? [];
        const listingId = await insertPreviewListing(tx, {
          ...input.owners,
          previewPackId: input.action.baseline.packId,
          dealerKey: input.action.dealerKey,
          sourceRunId: input.action.sourceRunId,
          identityKey: planned.identityKey,
          listing: planned.listing,
          images,
          catalog: input.catalog,
        });
        if (!listingId) {
          throw new Error(`Exact replacement failed for ${planned.identityKey}.`);
        }
        evidence.push({
          identityKey: planned.identityKey,
          listingId,
          sourceUrls: planned.images.map((image) => image.sourceUrl),
          sourceChecksums: planned.images.map((image) => image.checksum),
          publicIds: images.map((image) => image.publicId),
          finalImages: images.map((image) => ({
            publicId: image.publicId,
            width: image.width,
            height: image.height,
            format: image.format,
            bytes: image.bytes,
          })),
        });
      }
      const enabled = await tx.dealerPreviewPack.updateMany({
        where: {
          id: input.action.baseline.packId,
          dealerProfileId: input.owners.dealerId,
          sourceRunId: input.action.sourceRunId,
          enabled: false,
        },
        data: { enabled: true },
      });
      if (enabled.count !== 1) {
        throw new Error("Exact replacement could not safely enable the pack.");
      }
      await writePreviewLedger(tx, input.plan, {
        dealerKey: input.action.dealerKey,
        action: input.action.kind,
        status: "applied",
        listings: evidence,
      });
    }, { timeout: 300_000 });
    return evidence;
  } catch (error) {
    await cleanupPreviewUploadedImages(uploaded.allUploaded).catch(() => undefined);
    throw error;
  }
}

export async function applyPreviewPackAuditPlan(input: {
  prisma: PrismaClient;
  plan: PreviewPackAuditPlan;
}) {
  const results: AppliedPackResult[] = [];
  const catalog = input.plan.actions.some((action) => action.kind === "replace")
    ? await loadPreviewPackCatalog(input.prisma)
    : null;
  for (const action of input.plan.actions) {
    try {
      const recovered = await readPreviewLedger(input.prisma, input.plan, action);
      if (recovered) {
        results.push(recovered);
        continue;
      }
      const owners = await stagePackDisabled(input.prisma, action);
      if (action.kind === "disable") {
        await applyDisable(input.prisma, action, input.plan, owners);
        results.push({ dealerKey: action.dealerKey, action: action.kind, status: "applied" });
      } else {
        if (!catalog) throw new Error("Preview catalogue was not loaded.");
        const listings = await applyReplace({
          prisma: input.prisma,
          action,
          owners,
          catalog,
          plan: input.plan,
        });
        results.push({
          dealerKey: action.dealerKey,
          action: action.kind,
          status: "applied",
          listings,
        });
      }
    } catch (error) {
      results.push({
        dealerKey: action.dealerKey,
        action: action.kind,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }
  return results;
}
