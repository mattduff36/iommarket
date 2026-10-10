import { createHash } from "node:crypto";
import { calculateExpiryDate } from "../listing-status";
import { dealerSyncBlockReason } from "./eligibility";
import { fingerprintSnapshot, type FingerprintSnapshot } from "./fingerprint";
import { isOwnedListingImage } from "./images";
import type { OwnedListingImage, CreatePlanAction, PlanAction, UpdatePlanAction } from "./types";

export class StalePlanError extends Error {
  constructor(message = "The stock sync plan is stale.") {
    super(message);
    this.name = "StalePlanError";
  }
}

export interface TakeDownRequest {
  listingId: string;
  expectedRevision: number;
  actorId: string;
  notes: string;
}

interface WriteResult {
  count: number;
}

export interface ApplyWriter {
  listing: {
    updateMany(args: { where: object; data: object }): Promise<WriteResult>;
    create(args: { data: object }): Promise<{ id: string }>;
  };
  listingAttributeValue: {
    updateMany(args: { where: object; data: object }): Promise<WriteResult>;
    createMany(args: { data: object[] }): Promise<WriteResult>;
  };
  listingImage: {
    createMany(args: { data: object[] }): Promise<WriteResult>;
  };
  listingStatusEvent: {
    create(args: { data: object }): Promise<{ id: string }>;
  };
  category: {
    findFirst(args: { where: object }): Promise<{ id: string } | null>;
  };
  region: {
    findFirst(args: { where: object }): Promise<{ id: string } | null>;
  };
  attributeDefinition: {
    findMany(args: { where: object }): Promise<Array<{ id: string; slug: string; required: boolean }>>;
  };
  dealerStockSourceIdentity: {
    updateMany(args: { where: object; data: object }): Promise<WriteResult>;
  };
  dealerStockSyncReport: {
    updateMany(args: { where: object; data: object }): Promise<WriteResult>;
  };
  dealerStockSyncAudit: {
    create(args: { data: object }): Promise<{ id: string }>;
  };
}

function priceChange(action: UpdatePlanAction) {
  return action.changes.find((change) => change.field === "price") ?? null;
}

function mileageChange(action: UpdatePlanAction) {
  return action.changes.find((change) => change.field === "mileage") ?? null;
}

async function applyUpdate(client: ApplyWriter, action: UpdatePlanAction) {
  const price = priceChange(action);
  const mileage = mileageChange(action);
  const nextPrice = price?.after ?? null;
  const updated = await client.listing.updateMany({
    where: {
      id: action.listingId,
      status: "LIVE",
      featured: action.featured,
      lifecycleRevision: action.lifecycleRevision,
      photoRevision: action.photoRevision,
      ...(price ? { price: price.before } : {}),
    },
    data: {
      ...(price && nextPrice != null ? { price: nextPrice } : {}),
      lifecycleRevision: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new StalePlanError();
  if (mileage && mileage.before != null && mileage.after != null) {
    const mileageWrite = await client.listingAttributeValue.updateMany({
      where: {
        listingId: action.listingId,
        value: String(mileage.before),
        attributeDefinition: { slug: "mileage" },
      },
      data: { value: String(mileage.after) },
    });
    if (mileageWrite.count !== 1) throw new StalePlanError();
  }
  const baseline = await client.dealerStockSourceIdentity.updateMany({
    where: { listingId: action.listingId, sourceIdentityKey: action.sourceIdentityKey },
    data: {
      ...(price ? { baselinePricePence: price.after } : {}),
      ...(mileage ? { baselineMileage: mileage.after } : {}),
    },
  });
  if (baseline.count !== 1) throw new StalePlanError();

}

async function applyCreate(
  client: ApplyWriter,
  action: CreatePlanAction,
  dealer: FingerprintSnapshot["dealer"],
  actorId: string,
  images: OwnedListingImage[],
  now: Date,
) {
  if (!images.length || images.some((image) => !isOwnedListingImage(image))) {
    throw new StalePlanError("Owned listing images are required.");
  }
  const category = await client.category.findFirst({
    where: { slug: action.categorySlug, active: true },
  });
  const region = dealer.regionId
    ? await client.region.findFirst({ where: { id: dealer.regionId, active: true } })
    : null;
  if (!category || !region) throw new StalePlanError("Category or region is no longer available.");
  const definitions = await client.attributeDefinition.findMany({ where: { categoryId: category.id } });
  const missing = definitions.filter((definition) => definition.required && !action.attributes[definition.slug]);
  if (missing.length > 0) throw new StalePlanError("Required vehicle details are missing.");
  const listing = await client.listing.create({
    data: {
      userId: dealer.userId,
      dealerId: dealer.id,
      categoryId: category.id,
      regionId: region.id,
      title: action.title,
      description: action.description,
      price: action.pricePence,
      status: "LIVE",
      slug: `stock-${createHash("sha256").update(`${dealer.id}:${action.sourceIdentityKey}`).digest("hex").slice(0, 24)}`,
      expiresAt: calculateExpiryDate(now),
      reviewSourceUrl: action.sourceUrl ?? null,
      featured: false,
      reviewSourceIdentity: action.sourceIdentityKey,
      previewPackId: null,
    },
  });
  await client.listingImage.createMany({
    data: images.map((image) => ({
      listingId: listing.id,
      url: image.url,
      publicId: image.publicId,
      order: image.order,
      provider: image.provider,
      width: image.width,
      height: image.height,
      assetId: image.assetId ?? null,
      version: image.version ?? null,
      imageKitFileId: image.imageKitFileId ?? null,
      imageKitFilePath: image.imageKitFilePath ?? null,
    })),
  });
  const values = definitions
    .filter((definition) => action.attributes[definition.slug] != null)
    .map((definition) => ({
      listingId: listing.id,
      attributeDefinitionId: definition.id,
      value: action.attributes[definition.slug] ?? "",
    }));
  if (values.length > 0) await client.listingAttributeValue.createMany({ data: values });
  const linked = await client.dealerStockSourceIdentity.updateMany({
    where: { dealerId: dealer.id, sourceIdentityKey: action.sourceIdentityKey, listingId: null },
    data: { listingId: listing.id, baselinePricePence: action.pricePence, baselineMileage: action.attributes.mileage ? Number(action.attributes.mileage) : null },
  });
  if (linked.count !== 1) throw new StalePlanError();
  await client.listingStatusEvent.create({
    data: {
      listingId: listing.id,
      fromStatus: null,
      toStatus: "LIVE",
      changedByUserId: actorId,
      source: "ADMIN",
      action: "SUBMIT",
      notes: "Created from an approved website stock sync plan.",
    },
  });
  return listing.id;
}

export async function applyFrozenPlan(input: {
  client: ApplyWriter;
  snapshot: FingerprintSnapshot;
  storedFingerprint: string;
  reportId: string;
  reportStatus: string;
  actorId: string;
  jobId: string;
  now: Date;
  stagedImages?: Record<string, OwnedListingImage[]>;
  takeDown: (request: TakeDownRequest) => Promise<void>;
}) {
  if (input.reportStatus === "APPLIED") return { status: "already-applied" as const };
  if (input.reportStatus !== "APPROVED") throw new StalePlanError("This report can no longer be applied.");
  const block = dealerSyncBlockReason({
    isAdminPreview: input.snapshot.dealer.isAdminPreview,
    role: input.snapshot.dealer.role as "USER" | "DEALER" | "ADMIN",
    disabledAt: input.snapshot.dealer.disabledAt,
    deletedAt: input.snapshot.dealer.deletedAt,
  });
  if (block) throw new StalePlanError("The dealer account can no longer be synced.");
  const current = fingerprintSnapshot(input.snapshot);
  if (current !== input.storedFingerprint) throw new StalePlanError();
  const creates = input.snapshot.actions.filter((action) => action.kind === "create");
  if (input.snapshot.activeListingCount + creates.length > input.snapshot.listingCap) {
    throw new StalePlanError("The dealer listing cap would be exceeded.");
  }

  for (const action of input.snapshot.actions) {
    const before = { action };
    if (action.kind === "update") await applyUpdate(input.client, action);
    if (action.kind === "unpublish") {
      await input.takeDown({
        listingId: action.listingId,
        expectedRevision: action.lifecycleRevision,
        actorId: input.actorId,
        notes: "Absent from two complete website stock scrapes.",
      });
    }
    if (action.kind === "create") {
      await applyCreate(input.client, action, input.snapshot.dealer, input.actorId, input.stagedImages?.[action.sourceIdentityKey] ?? action.ownedImages, input.now);
    }
    if (action.kind === "update" || action.kind === "unpublish" || action.kind === "create") {
      await input.client.dealerStockSyncAudit.create({
        data: {
          reportId: input.reportId,
          jobId: input.jobId,
          actorId: input.actorId,
          action: action.kind,
          before,
          after: { action, appliedAt: input.now.toISOString() },
        },
      });
    }
  }

  const applied = await input.client.dealerStockSyncReport.updateMany({
    where: { id: input.reportId, status: "APPROVED", fingerprint: input.storedFingerprint },
    data: { status: "APPLIED", appliedAt: input.now },
  });
  if (applied.count !== 1) throw new StalePlanError();
  return { status: "applied" as const };
}

export function executableActions(actions: PlanAction[]) {
  return actions.filter(
    (action) => action.kind === "create" || action.kind === "update" || action.kind === "unpublish",
  );
}
