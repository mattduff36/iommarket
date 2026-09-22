import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { mapReconciledVehicle } from "../../scripts/dealer-stock-sync/map-listing";
import { readDealerSnapshot } from "../../scripts/dealer-stock-sync/archive/read";
import { canonicalDealerDisplayName, getDealer } from "../../scripts/dealer-stock-sync/registry";
import { dealerSnapshotPath, findLatestRunForDealer, registryGroupKey } from "./archive";
import {
  assertNotOceanDealerProfile,
  assertPreviewDealerAllowed,
  OCEAN_OWNER_EMAIL,
  previewDealerSlug,
  previewSystemAuthUserId,
  previewSystemEmail,
} from "./safety";
import { mapWithConcurrency } from "./concurrency";
import { PREVIEW_PACK_VEHICLE_CONCURRENCY } from "./limits";
import {
  planPreviewPackResume,
  summarizePreviewResumePlan,
  sanitizePreviewSegment,
  type PreviewResumeAction,
} from "./resume";
import {
  cleanupPreviewUploadedImages,
  enqueuePreviewUploadedImageCleanup,
  previewImageSources,
  uploadPreviewPackImages,
  type PreviewUploadedImage,
} from "./upload";

async function loadCatalog() {
  const [categories, region, attributes] = await Promise.all([
    db.category.findMany({ select: { id: true, slug: true } }),
    db.region.findFirst({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    }),
    db.attributeDefinition.findMany({
      select: { id: true, slug: true, categoryId: true },
    }),
  ]);
  if (!region) throw new Error("No active region is available for preview listings.");
  return {
    categories: Object.fromEntries(categories.map((item) => [item.slug, item.id])),
    regionId: region.id,
    attributes,
  };
}

export async function ensurePreviewDealer(input: {
  dealerKey: string;
  displayName: string;
  website?: string | null;
}) {
  assertPreviewDealerAllowed({
    dealerKey: input.dealerKey,
    displayName: input.displayName,
    groupKey: registryGroupKey(input.dealerKey),
  });

  const email = previewSystemEmail(input.dealerKey);
  const authUserId = previewSystemAuthUserId(input.dealerKey);
  const slug = previewDealerSlug(input.dealerKey);

  const protectedOwner = await db.user.findFirst({
    where: { email: { equals: OCEAN_OWNER_EMAIL, mode: "insensitive" } },
    select: { id: true, dealerProfile: { select: { id: true } } },
  });
  if (protectedOwner?.dealerProfile) {
    const clash = await db.dealerProfile.findFirst({
      where: { id: protectedOwner.dealerProfile.id, slug },
      select: { id: true },
    });
    if (clash) {
      throw new Error("Refuse to attach preview listings to the Ocean dealer profile.");
    }
  }

  const existingReal = await db.dealerProfile.findFirst({
    where: {
      slug,
      isAdminPreview: false,
    },
    select: { id: true },
  });
  if (existingReal) {
    throw new Error("A real dealer already uses this preview slug.");
  }

  return db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { authUserId },
      update: { email, name: input.displayName, role: "DEALER" },
      create: {
        authUserId,
        email,
        name: input.displayName,
        role: "DEALER",
      },
    });
    const dealer = await tx.dealerProfile.upsert({
      where: { userId: user.id },
      update: {
        name: input.displayName,
        slug,
        website: input.website ?? null,
        isAdminPreview: true,
        verified: false,
      },
      create: {
        userId: user.id,
        name: input.displayName,
        slug,
        website: input.website ?? null,
        isAdminPreview: true,
        verified: false,
      },
    });
    return { userId: user.id, dealerId: dealer.id };
  });
}

export async function insertPreviewListing(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dealerId: string;
    previewPackId: string;
    dealerKey: string;
    sourceRunId: string;
    identityKey: string;
    listing: NonNullable<ReturnType<typeof mapReconciledVehicle>["listing"]>;
    images: Awaited<ReturnType<typeof uploadPreviewPackImages>>;
    catalog: Awaited<ReturnType<typeof loadCatalog>>;
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.previewPackId}))`;
  const pack = await tx.dealerPreviewPack.findFirst({
    where: {
      id: input.previewPackId,
      dealerKey: input.dealerKey,
      dealerProfileId: input.dealerId,
      sourceRunId: input.sourceRunId,
    },
    select: { id: true },
  });
  if (!pack) return null;
  if (input.images.length === 0) return null;
  const identityPrefix =
    `${IMAGE_CONSTRAINTS.folder}/preview-packs/` +
    `${sanitizePreviewSegment(input.dealerKey)}/` +
    `${sanitizePreviewSegment(input.identityKey)}/`;
  const existing = await tx.listing.findFirst({
    where: {
      previewPackId: input.previewPackId,
      dealerId: input.dealerId,
      status: "ADMIN_PREVIEW",
      images: { some: { publicId: { startsWith: identityPrefix } } },
    },
    select: { id: true },
  });
  if (existing) return null;
  const categoryId = input.catalog.categories[input.listing.categorySlug];
  if (!categoryId) throw new Error(`Missing category ${input.listing.categorySlug}`);
  const now = new Date();
  const created = await tx.listing.create({
    data: {
      userId: input.userId,
      dealerId: input.dealerId,
      previewPackId: input.previewPackId,
      categoryId,
      regionId: input.catalog.regionId,
      title: input.listing.title,
      description: input.listing.description,
      price: input.listing.pricePence,
      status: "ADMIN_PREVIEW",
      featured: false,
      expiresAt: null,
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: now,
    },
  });

  const attrIds = Object.fromEntries(
    input.catalog.attributes
      .filter((item) => item.categoryId === categoryId)
      .map((item) => [item.slug, item.id]),
  );
  await tx.listingAttributeValue.createMany({
    data: Object.entries(input.listing.attributes)
      .filter(([slug]) => attrIds[slug])
      .map(([slug, value]) => ({
        listingId: created.id,
        attributeDefinitionId: attrIds[slug],
        value,
      })),
  });
  if (input.images.length > 0) {
    await tx.listingImage.createMany({
      data: input.images.map((image) => ({
        listingId: created.id,
        url: image.url,
        publicId: image.publicId,
        order: image.order,
        provider: "CLOUDINARY",
        assetId: image.assetId,
        version: image.version,
        width: image.width,
        height: image.height,
        format: image.format,
        bytes: image.bytes,
      })),
    });
  }
  return created.id;
}

export async function attachPreviewImages(input: {
  listingId: string;
  previewPackId: string;
  dealerId: string;
  dealerKey: string;
  sourceRunId: string;
  expectedPhotoRevision: number;
  expectedPublicIds: string[];
  images: PreviewUploadedImage[];
}) {
  if (input.images.length === 0) return false;
  return db.$transaction(async (tx) => {
    const pack = await tx.dealerPreviewPack.findFirst({
      where: {
        id: input.previewPackId,
        dealerKey: input.dealerKey,
        dealerProfileId: input.dealerId,
        sourceRunId: input.sourceRunId,
      },
      select: { id: true },
    });
    const current = await tx.listing.findFirst({
      where: {
        id: input.listingId,
        previewPackId: input.previewPackId,
        dealerId: input.dealerId,
        status: "ADMIN_PREVIEW",
        photoRevision: input.expectedPhotoRevision,
      },
      select: {
        images: {
          orderBy: { order: "asc" },
          select: { publicId: true },
        },
        revisions: {
          where: { status: { in: ["DRAFT", "PENDING"] } },
          select: { id: true },
        },
      },
    });
    if (
      !pack ||
      !current ||
      current.revisions.length > 0 ||
      JSON.stringify(current.images.map((image) => image.publicId)) !==
        JSON.stringify(input.expectedPublicIds)
    ) {
      return false;
    }
    const claimed = await tx.listing.updateMany({
      where: {
        id: input.listingId,
        previewPackId: input.previewPackId,
        dealerId: input.dealerId,
        status: "ADMIN_PREVIEW",
        photoRevision: input.expectedPhotoRevision,
      },
      data: { photoRevision: { increment: 1 } },
    });
    if (claimed.count !== 1) return false;
    await tx.listingImage.createMany({
      data: input.images.map((image) => ({
        listingId: input.listingId,
        url: image.url,
        publicId: image.publicId,
        order: image.order,
        provider: "CLOUDINARY",
        assetId: image.assetId,
        version: image.version,
        width: image.width,
        height: image.height,
        format: image.format,
        bytes: image.bytes,
      })),
    });
    return true;
  });
}

async function loadExistingPreviewListings(previewPackId: string) {
  const listings = await db.listing.findMany({
    where: { previewPackId },
    select: {
      id: true,
      title: true,
      price: true,
      photoRevision: true,
      images: { select: { publicId: true, order: true } },
      attributeValues: {
        where: { attributeDefinition: { slug: "mileage" } },
        select: { value: true },
      },
    },
  });
  return listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    pricePence: listing.price,
    mileage: listing.attributeValues[0]?.value ?? null,
    photoRevision: listing.photoRevision,
    images: listing.images,
  }));
}

export async function previewPackExists(dealerKey: string) {
  const pack = await db.dealerPreviewPack.findUnique({
    where: { dealerKey },
    select: { id: true },
  });
  return Boolean(pack);
}

export async function setPreviewPackEnabled(dealerKey: string, enabled: boolean) {
  const pack = await db.dealerPreviewPack.findUnique({
    where: { dealerKey },
    include: { dealerProfile: { include: { user: { select: { email: true } } } } },
  });
  if (!pack) {
    if (!enabled) return { enabled: false, missing: true as const };
    throw new Error("Preview pack has not been materialized yet.");
  }
  assertPreviewDealerAllowed({
    dealerKey,
    displayName: pack.displayName,
    groupKey: registryGroupKey(dealerKey),
    ownerEmail: pack.dealerProfile.user.email,
  });
  return db.dealerPreviewPack.update({
    where: { dealerKey },
    data: { enabled },
  });
}

async function loadPreviewSnapshot(dealerKey: string) {
  const runId = findLatestRunForDealer(dealerKey);
  if (!runId) {
    throw new Error("Archive not on this host — enable once from local preview.");
  }
  const snapshotDir = dealerSnapshotPath(dealerKey, runId);
  if (!existsSync(snapshotDir)) {
    throw new Error("Archive not on this host — enable once from local preview.");
  }
  const snapshot = await readDealerSnapshot({ dealerKey, runId });
  const displayName = canonicalDealerDisplayName(dealerKey, snapshot.manifest.displayName);
  assertPreviewDealerAllowed({
    dealerKey,
    displayName,
    groupKey: registryGroupKey(dealerKey),
  });
  return { runId, snapshot, displayName };
}

function mappedPreviewVehicles(
  vehicles: Awaited<ReturnType<typeof readDealerSnapshot>>["vehicles"],
) {
  return vehicles.flatMap((vehicle) => {
    const mapped = mapReconciledVehicle(vehicle);
    if (!mapped.listing) return [];
    const sources = previewImageSources(vehicle.images, mapped.listing.imageUrls);
    return [{
      identityKey: vehicle.identityKey,
      title: mapped.listing.title,
      pricePence: mapped.listing.pricePence,
      mileage: mapped.listing.attributes.mileage ?? null,
      sourceCount: sources.length,
      listing: mapped.listing,
      sources,
      vehicle,
    }];
  });
}

export async function inspectPreviewPack(dealerKey: string) {
  const { snapshot, displayName } = await loadPreviewSnapshot(dealerKey);
  const existing = await db.dealerPreviewPack.findUnique({
    where: { dealerKey },
    select: { id: true, enabled: true, displayName: true },
  });
  const listings = existing ? await loadExistingPreviewListings(existing.id) : [];
  const vehicles = mappedPreviewVehicles(snapshot.vehicles);
  const actions = planPreviewPackResume({
    dealerKey,
    vehicles,
    listings,
  });
  return {
    dealerKey,
    displayName,
    skipped: snapshot.vehicles.length - vehicles.length,
    actions,
    summary: summarizePreviewResumePlan(actions),
  };
}

async function applyResumeAction(input: {
  dealerKey: string;
  action: PreviewResumeAction;
  mapped: ReturnType<typeof mappedPreviewVehicles>[number];
  owners: { userId: string; dealerId: string };
  packId: string;
  sourceRunId: string;
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
}) {
  if (input.action.kind === "complete") {
    return { created: 0, skipped: 0, backfilled: 0 };
  }
  if (input.action.kind === "skip") {
    return { created: 0, skipped: 1, backfilled: 0 };
  }
  const sources = input.action.kind === "backfill"
    ? input.mapped.sources
      .map((source, order) => ({ ...source, order }))
      .filter((source) => input.action.kind === "backfill" && input.action.missingOrders.includes(source.order))
    : input.mapped.sources;
  if (sources.length === 0) {
    return { created: 0, skipped: 1, backfilled: 0 };
  }
  const images = sources.length > 0
    ? await uploadPreviewPackImages({
        dealerKey: input.dealerKey,
        identityKey: input.mapped.identityKey,
        sources,
        attemptId: randomUUID(),
      }).catch(() => [])
    : [];
  if (images.length !== sources.length) {
    await cleanupPreviewUploadedImages(images);
    return { created: 0, skipped: 1, backfilled: 0 };
  }
  if (input.action.kind === "backfill") {
    const attached = await attachPreviewImages({
      listingId: input.action.listingId,
      previewPackId: input.packId,
      dealerId: input.owners.dealerId,
      dealerKey: input.dealerKey,
      sourceRunId: input.sourceRunId,
      expectedPhotoRevision: input.action.expectedPhotoRevision,
      expectedPublicIds: input.action.expectedPublicIds,
      images,
    });
    if (!attached) {
      await cleanupPreviewUploadedImages(images);
      return { created: 0, skipped: 1, backfilled: 0 };
    }
    return { created: 0, skipped: 0, backfilled: images.length };
  }
  try {
    const createdId = await db.$transaction((tx) =>
      insertPreviewListing(tx, {
        userId: input.owners.userId,
        dealerId: input.owners.dealerId,
        previewPackId: input.packId,
        dealerKey: input.dealerKey,
        sourceRunId: input.sourceRunId,
        identityKey: input.mapped.identityKey,
        listing: input.mapped.listing,
        images,
        catalog: input.catalog,
      }),
    );
    if (!createdId) {
      await cleanupPreviewUploadedImages(images);
      return { created: 0, skipped: 1, backfilled: 0 };
    }
  } catch (error) {
    await enqueuePreviewUploadedImageCleanup(
      db,
      images,
      `preview-materialize-transaction-uncertain:${input.dealerKey}:${input.sourceRunId}`,
    );
    throw error;
  }
  return { created: 1, skipped: 0, backfilled: 0 };
}

export async function materializePreviewPack(dealerKey: string) {
  const { runId, snapshot, displayName } = await loadPreviewSnapshot(dealerKey);
  let website: string | null = null;
  try {
    website = getDealer(dealerKey).website;
  } catch {
    website = null;
  }

  const existing = await db.dealerPreviewPack.findUnique({
    where: { dealerKey },
    select: { id: true, sourceRunId: true, dealerProfileId: true },
  });
  if (existing && existing.sourceRunId !== runId) {
    throw new Error(
      "Refusing preview materialization: the existing pack belongs to a different source run.",
    );
  }
  const catalog = await loadCatalog();
  const owners = await ensurePreviewDealer({
    dealerKey,
    displayName,
    website,
  });
  const oceanDealer = await db.dealerProfile.findFirst({
    where: { user: { email: { equals: OCEAN_OWNER_EMAIL, mode: "insensitive" } } },
    select: { id: true },
  });
  assertNotOceanDealerProfile({
    dealerId: owners.dealerId,
    oceanDealerId: oceanDealer?.id,
  });
  if (existing && existing.dealerProfileId !== owners.dealerId) {
    throw new Error("Refusing preview materialization: pack dealer ownership changed.");
  }
  const pack = existing
    ? existing
    : await db.dealerPreviewPack.create({
        data: {
          dealerKey,
          displayName,
          sourceRunId: runId,
          enabled: false,
          dealerProfileId: owners.dealerId,
        },
      });

  const mapped = mappedPreviewVehicles(snapshot.vehicles);
  const listings = await loadExistingPreviewListings(pack.id);
  const actions = planPreviewPackResume({
    dealerKey,
    vehicles: mapped,
    listings,
  });
  const mappedByKey = new Map(mapped.map((item) => [item.identityKey, item]));
  const work = actions.filter((action) => action.kind !== "complete");
  const outcomes = await mapWithConcurrency(work, PREVIEW_PACK_VEHICLE_CONCURRENCY, async (action) => {
    const item = mappedByKey.get(action.identityKey);
    if (!item) return { created: 0, skipped: 0, backfilled: 0 };
    return applyResumeAction({
      dealerKey,
      action,
      mapped: item,
      owners,
      packId: pack.id,
      sourceRunId: pack.sourceRunId,
      catalog,
    });
  });

  const updatedPack = await db.dealerPreviewPack.updateMany({
    where: {
      id: pack.id,
      dealerKey,
      dealerProfileId: owners.dealerId,
      sourceRunId: runId,
    },
    data: { enabled: true, displayName },
  });
  if (updatedPack.count !== 1) {
    throw new Error("Refusing preview materialization: pack source changed during apply.");
  }

  return {
    created: outcomes.reduce((sum, row) => sum + row.created, 0),
    skipped:
      snapshot.vehicles.length -
      mapped.length +
      outcomes.reduce((sum, row) => sum + row.skipped, 0),
    backfilled: outcomes.reduce((sum, row) => sum + row.backfilled, 0),
    packId: pack.id,
  };
}
