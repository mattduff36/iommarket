import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateExpiryDate } from "../../lib/listing-status";
import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import {
  FOUNDING_IMPORT_NOTES,
  OCEAN_IMPORT_NOTES,
  assertProductionBaselineMatches,
  captureProductionAccountBaseline,
} from "./production-baseline";
import {
  cleanupProductionUploads,
  uploadProductionReplacement,
  type ProductionUploadedImage,
} from "./production-media";
import {
  PRODUCTION_ACCOUNTS,
  type ProductionApplyReport,
  type ProductionAuditPlan,
  type ProductionListingAction,
  type ProductionUploadedEvidence,
} from "./production-types";

const PRODUCTION_AUDIT_LOCK = 20260928223805;
const PRODUCTION_LEDGER_ACTION = "DEALER_PACK_PRODUCTION_APPLY";
const PRODUCTION_LEDGER_ENTITY = "DealerProductionAudit";
const OWNED_MEDIA_PREFIXES = [
  `${IMAGE_CONSTRAINTS.folder}/founding/`,
  `${IMAGE_CONSTRAINTS.folder}/import/`,
  `${IMAGE_CONSTRAINTS.folder}/repair/`,
] as const;

interface Catalog {
  categories: Record<string, string>;
  regions: Record<string, string>;
  attributes: Array<{ id: string; slug: string; categoryId: string }>;
}

interface StagedAction {
  dealerKey: string;
  action: Extract<ProductionListingAction, { kind: "create" | "update" }>;
  images: ProductionUploadedImage[];
}

function actionKey(dealerKey: string, identityKey: string) {
  return `${dealerKey}\0${identityKey}`;
}

async function cleanupStagedAndThrow(
  staged: StagedAction[],
  error: unknown,
): Promise<never> {
  try {
    await cleanupProductionUploads(staged.flatMap((item) => item.images));
  } catch (cleanupError) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
    );
  }
  throw error;
}

async function loadCatalog(tx: Prisma.TransactionClient): Promise<Catalog> {
  const [categories, regions, attributes] = await Promise.all([
    tx.category.findMany({ select: { id: true, slug: true } }),
    tx.region.findMany({ select: { id: true, slug: true } }),
    tx.attributeDefinition.findMany({
      select: { id: true, slug: true, categoryId: true },
    }),
  ]);
  return {
    categories: Object.fromEntries(categories.map((item) => [item.slug, item.id])),
    regions: Object.fromEntries(regions.map((item) => [item.slug, item.id])),
    attributes,
  };
}

function resolveCatalog(
  catalog: Catalog,
  action: Extract<ProductionListingAction, { kind: "create" | "update" }>,
) {
  const categoryId = catalog.categories[action.source.listing.categorySlug];
  const regionId = catalog.regions[action.source.listing.regionSlug];
  if (!categoryId || !regionId) {
    throw new Error(`Production audit catalogue mismatch: ${action.identityKey}`);
  }
  const attributeIds = Object.fromEntries(
    catalog.attributes
      .filter((attribute) => attribute.categoryId === categoryId)
      .map((attribute) => [attribute.slug, attribute.id]),
  );
  const missing = Object.keys(action.source.listing.attributes)
    .filter((slug) => !attributeIds[slug]);
  if (missing.length > 0) {
    throw new Error(
      `Production audit attribute mismatch: ${action.identityKey}:${missing.join(",")}`,
    );
  }
  return { categoryId, regionId, attributeIds };
}

async function createAttributes(
  tx: Prisma.TransactionClient,
  listingId: string,
  attributes: Record<string, string>,
  attributeIds: Record<string, string>,
) {
  const data = Object.entries(attributes).map(([slug, value]) => ({
    listingId,
    attributeDefinitionId: attributeIds[slug]!,
    value,
  }));
  if (data.length > 0) await tx.listingAttributeValue.createMany({ data });
}

async function createImages(
  tx: Prisma.TransactionClient,
  listingId: string,
  images: ProductionUploadedImage[],
) {
  await tx.listingImage.createMany({
    data: images.map((image) => ({
      listingId,
      url: image.url,
      publicId: image.publicId,
      order: image.order,
      provider: image.provider,
      assetId: image.assetId,
      version: image.version,
      width: image.width,
      height: image.height,
      format: image.format,
      bytes: image.bytes,
    })),
  });
}

function provenanceNotes(sourceKind: "founding" | "ocean") {
  return sourceKind === "founding" ? FOUNDING_IMPORT_NOTES : OCEAN_IMPORT_NOTES;
}

async function createProvenanceEvents(input: {
  tx: Prisma.TransactionClient;
  listingId: string;
  adminUserId: string;
  sourceKind: "founding" | "ocean";
}) {
  const notes = provenanceNotes(input.sourceKind);
  await input.tx.listingStatusEvent.createMany({
    data: [
      {
        listingId: input.listingId,
        fromStatus: null,
        toStatus: "DRAFT",
        source: "ADMIN",
        action: "SYSTEM_BACKFILL",
        changedByUserId: input.adminUserId,
        notes,
      },
      {
        listingId: input.listingId,
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        source: "ADMIN",
        action: "SUBMIT",
        changedByUserId: input.adminUserId,
        notes,
      },
      {
        listingId: input.listingId,
        fromStatus: "PENDING",
        toStatus: "LIVE",
        source: "ADMIN",
        action: "APPROVE",
        changedByUserId: input.adminUserId,
        notes,
      },
    ],
  });
}

async function enqueueOldOwnedMedia(
  tx: Prisma.TransactionClient,
  dealerKey: string,
  images: Array<{ publicId: string; provider: string }>,
) {
  const publicIds = productionCleanupPublicIds(images);
  if (publicIds.length === 0) return;
  await tx.listingImageCleanupJob.createMany({
    data: publicIds.map((publicId) => ({
      publicId,
      deliveryType: IMAGE_CONSTRAINTS.deliveryType,
      reason: `dealer-pack-production-sync:${dealerKey}`,
    })),
  });
}

export function productionCleanupPublicIds(
  images: Array<{ publicId: string; provider: string }>,
) {
  return [...new Set(images
    .filter((image) =>
      image.provider === "CLOUDINARY" &&
      OWNED_MEDIA_PREFIXES.some((prefix) => image.publicId.startsWith(prefix)))
    .map((image) => image.publicId))];
}

async function applyCreate(input: {
  tx: Prisma.TransactionClient;
  accountPlan: ProductionAuditPlan["accounts"][number];
  action: Extract<ProductionListingAction, { kind: "create" }>;
  images: ProductionUploadedImage[];
  catalog: Catalog;
  adminUserId: string;
}) {
  const resolved = resolveCatalog(input.catalog, input.action);
  const now = new Date();
  const created = await input.tx.listing.create({
    data: {
      userId: input.accountPlan.baseline.user.id,
      dealerId: input.accountPlan.baseline.dealer.id,
      categoryId: resolved.categoryId,
      regionId: resolved.regionId,
      title: input.action.source.listing.title,
      description: input.action.source.listing.description,
      price: input.action.source.listing.pricePence,
      status: "LIVE",
      featured: false,
      slug: input.action.source.slug,
      previewPackId: null,
      expiresAt: calculateExpiryDate(now),
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: now,
    },
  });
  await createAttributes(
    input.tx,
    created.id,
    input.action.source.listing.attributes,
    resolved.attributeIds,
  );
  await createImages(input.tx, created.id, input.images);
  await createProvenanceEvents({
    tx: input.tx,
    listingId: created.id,
    adminUserId: input.adminUserId,
    sourceKind: input.accountPlan.sourceKind,
  });
  return created.id;
}

async function applyUpdate(input: {
  tx: Prisma.TransactionClient;
  accountPlan: ProductionAuditPlan["accounts"][number];
  action: Extract<ProductionListingAction, { kind: "update" }>;
  images: ProductionUploadedImage[];
  catalog: Catalog;
  adminUserId: string;
}) {
  const old = input.accountPlan.baseline.listings.find(
    (listing) => listing.id === input.action.listingId,
  );
  if (!old) throw new Error(`Production baseline listing missing: ${input.action.listingId}`);
  const resolved = resolveCatalog(input.catalog, input.action);
  await enqueueOldOwnedMedia(input.tx, input.accountPlan.dealerKey, old.images);
  await input.tx.listingImage.deleteMany({ where: { listingId: old.id } });
  await input.tx.listingAttributeValue.deleteMany({ where: { listingId: old.id } });
  const statusChanged = old.status !== "LIVE";
  const updated = await input.tx.listing.updateMany({
    where: {
      id: old.id,
      userId: input.accountPlan.baseline.user.id,
      dealerId: input.accountPlan.baseline.dealer.id,
      lifecycleRevision: old.lifecycleRevision,
      photoRevision: old.photoRevision,
    },
    data: {
      categoryId: resolved.categoryId,
      regionId: resolved.regionId,
      title: input.action.source.listing.title,
      description: input.action.source.listing.description,
      price: input.action.source.listing.pricePence,
      status: "LIVE",
      featured: false,
      slug: input.action.source.slug,
      previewPackId: null,
      expiresAt: calculateExpiryDate(new Date()),
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: new Date(),
      photoRevision: { increment: 1 },
      lifecycleRevision: statusChanged ? { increment: 1 } : undefined,
    },
  });
  if (updated.count !== 1) {
    throw new Error(`Production listing CAS failed: ${old.id}`);
  }
  await createAttributes(
    input.tx,
    old.id,
    input.action.source.listing.attributes,
    resolved.attributeIds,
  );
  await createImages(input.tx, old.id, input.images);
  if (statusChanged) {
    await input.tx.listingStatusEvent.create({
      data: {
        listingId: old.id,
        fromStatus: old.status as "TAKEN_DOWN",
        toStatus: "LIVE",
        source: "ADMIN",
        action: "REINSTATE_LIVE",
        changedByUserId: input.adminUserId,
        notes: `Dealer pack production sync (${input.accountPlan.dealerKey})`,
      },
    });
  }
  return old.id;
}

async function applyTakeDown(input: {
  tx: Prisma.TransactionClient;
  accountPlan: ProductionAuditPlan["accounts"][number];
  action: Extract<ProductionListingAction, { kind: "take_down" }>;
  adminUserId: string;
}) {
  const updated = await input.tx.listing.updateMany({
    where: {
      id: input.action.listingId,
      userId: input.accountPlan.baseline.user.id,
      dealerId: input.accountPlan.baseline.dealer.id,
      status: "LIVE",
    },
    data: { status: "TAKEN_DOWN", lifecycleRevision: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new Error(`Production stale listing CAS failed: ${input.action.listingId}`);
  }
  await input.tx.listingStatusEvent.create({
    data: {
      listingId: input.action.listingId,
      fromStatus: "LIVE",
      toStatus: "TAKEN_DOWN",
      source: "ADMIN",
      action: "TAKE_DOWN",
      changedByUserId: input.adminUserId,
      notes: `Dealer pack production sync stale source (${input.accountPlan.dealerKey})`,
    },
  });
}

export async function applyProductionAuditPlan(input: {
  prisma: PrismaClient;
  plan: ProductionAuditPlan;
}): Promise<ProductionApplyReport> {
  const ledgerId = `${input.plan.runId}:${input.plan.fingerprint}`;
  const recovered = await input.prisma.adminAuditLog.findFirst({
    where: {
      adminId: input.plan.adminUserId,
      action: PRODUCTION_LEDGER_ACTION,
      entityType: PRODUCTION_LEDGER_ENTITY,
      entityId: ledgerId,
    },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  if (recovered?.details) {
    return recovered.details as unknown as ProductionApplyReport;
  }
  const staged: StagedAction[] = [];
  try {
    for (const account of input.plan.accounts) {
      for (const action of account.actions) {
        if (action.kind === "take_down") continue;
        staged.push({
          dealerKey: account.dealerKey,
          action,
          images: await uploadProductionReplacement({
            runId: input.plan.runId,
            dealerKey: account.dealerKey,
            source: action.source,
          }),
        });
      }
    }
  } catch (error) {
    return cleanupStagedAndThrow(staged, error);
  }

  const stagedByAction = new Map(
    staged.map((item) => [
      actionKey(item.dealerKey, item.action.identityKey),
      item.images,
    ]),
  );
  const evidence: ProductionUploadedEvidence[] = [];
  let committedReport: ProductionApplyReport | null = null;
  try {
    await input.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRODUCTION_AUDIT_LOCK})`;
      for (const expected of input.plan.accounts) {
        const account = PRODUCTION_ACCOUNTS.find(
          (item) => item.dealerKey === expected.dealerKey,
        );
        if (!account) {
          throw new Error(`Production account is not allowlisted: ${expected.dealerKey}`);
        }
        const current = await captureProductionAccountBaseline(tx, account);
        assertProductionBaselineMatches(expected.baseline, current);
      }
      const catalog = await loadCatalog(tx);
      for (const account of input.plan.accounts) {
        for (const action of account.actions) {
          if (action.kind === "take_down") {
            await applyTakeDown({
              tx,
              accountPlan: account,
              action,
              adminUserId: input.plan.adminUserId,
            });
            continue;
          }
          const images = stagedByAction.get(
            actionKey(account.dealerKey, action.identityKey),
          );
          if (!images) throw new Error(`Staged production media missing: ${action.identityKey}`);
          const listingId = action.kind === "create"
            ? await applyCreate({
                tx,
                accountPlan: account,
                action,
                images,
                catalog,
                adminUserId: input.plan.adminUserId,
              })
            : await applyUpdate({
                tx,
                accountPlan: account,
                action,
                images,
                catalog,
                adminUserId: input.plan.adminUserId,
              });
          evidence.push({
            dealerKey: account.dealerKey,
            identityKey: action.identityKey,
            listingId,
            publicIds: images.map((image) => image.publicId),
            assetIds: images.map((image) => image.assetId),
            sourceChecksums: action.source.images.map((image) => image.checksum),
            finalImages: images.map((image) => ({
              publicId: image.publicId,
              assetId: image.assetId,
              width: image.width,
              height: image.height,
              format: image.format,
              bytes: image.bytes,
            })),
          });
        }
      }
      committedReport = {
        runId: input.plan.runId,
        planFingerprint: input.plan.fingerprint,
        createdAt: new Date().toISOString(),
        actionsApplied: input.plan.actionCount,
        listings: evidence,
      };
      await tx.adminAuditLog.create({
        data: {
          adminId: input.plan.adminUserId,
          action: PRODUCTION_LEDGER_ACTION,
          entityType: PRODUCTION_LEDGER_ENTITY,
          entityId: ledgerId,
          details: committedReport as unknown as Prisma.InputJsonValue,
        },
      });
    }, { isolationLevel: "Serializable", timeout: 300_000 });
  } catch (error) {
    return cleanupStagedAndThrow(staged, error);
  }
  if (!committedReport) {
    throw new Error("Production audit transaction committed without durable evidence.");
  }
  return committedReport;
}

export { OWNED_MEDIA_PREFIXES, PRODUCTION_AUDIT_LOCK };
