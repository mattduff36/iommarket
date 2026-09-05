import { existsSync } from "fs";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { mapReconciledVehicle } from "../../scripts/dealer-stock-sync/map-listing";
import { readDealerSnapshot } from "../../scripts/dealer-stock-sync/archive/read";
import { getDealer } from "../../scripts/dealer-stock-sync/registry";
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
  type PreviewResumeAction,
} from "./resume";
import { previewImageSources, uploadPreviewPackImages } from "./upload";

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

async function insertPreviewListing(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dealerId: string;
    previewPackId: string;
    listing: NonNullable<ReturnType<typeof mapReconciledVehicle>["listing"]>;
    images: Awaited<ReturnType<typeof uploadPreviewPackImages>>;
    catalog: Awaited<ReturnType<typeof loadCatalog>>;
  },
) {
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

async function attachPreviewImages(
  listingId: string,
  images: Awaited<ReturnType<typeof uploadPreviewPackImages>>,
) {
  if (images.length === 0) return;
  await db.listingImage.createMany({
    data: images.map((image) => ({
      listingId,
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

async function loadExistingPreviewListings(previewPackId: string) {
  const listings = await db.listing.findMany({
    where: { previewPackId },
    select: {
      id: true,
      title: true,
      price: true,
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
  assertPreviewDealerAllowed({
    dealerKey,
    displayName: snapshot.manifest.displayName,
    groupKey: registryGroupKey(dealerKey),
  });
  return { runId, snapshot };
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
  const { snapshot } = await loadPreviewSnapshot(dealerKey);
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
    displayName: snapshot.manifest.displayName,
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
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
}) {
  if (input.action.kind === "complete") {
    return { created: 0, skipped: 0, backfilled: 0 };
  }
  const sources = input.action.kind === "backfill"
    ? input.mapped.sources
      .map((source, order) => ({ ...source, order }))
      .filter((source) => input.action.kind === "backfill" && input.action.missingOrders.includes(source.order))
    : input.mapped.sources;
  const images = sources.length > 0
    ? await uploadPreviewPackImages({
        dealerKey: input.dealerKey,
        identityKey: input.mapped.identityKey,
        sources,
      }).catch(() => [])
    : [];
  if (input.action.kind === "backfill") {
    await attachPreviewImages(input.action.listingId, images);
    return { created: 0, skipped: 0, backfilled: images.length };
  }
  await db.$transaction((tx) =>
    insertPreviewListing(tx, {
      userId: input.owners.userId,
      dealerId: input.owners.dealerId,
      previewPackId: input.packId,
      listing: input.mapped.listing,
      images,
      catalog: input.catalog,
    }),
  );
  return { created: 1, skipped: 0, backfilled: 0 };
}

export async function materializePreviewPack(dealerKey: string) {
  const { runId, snapshot } = await loadPreviewSnapshot(dealerKey);
  let website: string | null = null;
  try {
    website = getDealer(dealerKey).website;
  } catch {
    website = null;
  }

  const existing = await db.dealerPreviewPack.findUnique({
    where: { dealerKey },
    select: { id: true },
  });
  const catalog = await loadCatalog();
  const owners = await ensurePreviewDealer({
    dealerKey,
    displayName: snapshot.manifest.displayName,
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
  const pack = existing
    ? existing
    : await db.dealerPreviewPack.create({
        data: {
          dealerKey,
          displayName: snapshot.manifest.displayName,
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
      catalog,
    });
  });

  await db.dealerPreviewPack.update({
    where: { id: pack.id },
    data: { enabled: true, sourceRunId: runId, displayName: snapshot.manifest.displayName },
  });

  return {
    created: outcomes.reduce((sum, row) => sum + row.created, 0),
    skipped: snapshot.vehicles.length - mapped.length,
    backfilled: outcomes.reduce((sum, row) => sum + row.backfilled, 0),
    packId: pack.id,
  };
}
