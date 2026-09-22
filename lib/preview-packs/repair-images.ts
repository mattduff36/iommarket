import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { FEATURED_LISTING_PHOTO_LIMIT } from "@/lib/listings/photo-limits";
import { mapReconciledVehicle } from "../../scripts/dealer-stock-sync/map-listing";
import { readDealerSnapshot } from "../../scripts/dealer-stock-sync/archive/read";
import { OCEAN_DEALER_KEY } from "./safety";
import { findLatestRunForDealer } from "./archive";
import { PREVIEW_PACK_PHOTO_LIMIT } from "./limits";
import {
  planPreviewPackResume,
  previewListingFingerprint,
  sanitizePreviewSegment,
} from "./resume";
import {
  previewImageSources,
  cleanupPreviewUploadedImages,
  uploadPreviewPackImages,
  type PreviewImageSource,
  type PreviewUploadedImage,
} from "./upload";

export const AFFECTED_PREVIEW_PACK_KEYS = [
  "ocean-motor-village",
  "rex-motor-company",
  "skillannaylor-car-company",
  "motorx",
  "bvs-vehicles",
  "manx-car-store",
  "ingear-car-sales",
  "swift-motors",
  "franklins",
  "van-mossel-jacksons",
  "van-mossel-motor-mall",
  "phil-shaw-vehicles",
] as const;

export type AffectedPreviewPackKey = (typeof AFFECTED_PREVIEW_PACK_KEYS)[number];

export function canEnqueuePreviewPackCleanup(publicId: string) {
  return publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/preview-packs/`);
}

export function isAffectedPreviewPackKey(value: string): value is AffectedPreviewPackKey {
  return (AFFECTED_PREVIEW_PACK_KEYS as readonly string[]).includes(value);
}

export interface PreviewRepairListing {
  id: string;
  title: string;
  pricePence: number;
  mileage: string | null;
  previewPackId: string;
  dealerId: string;
  status: string;
  photoRevision: number;
  images: Array<{ publicId: string; order: number }>;
}

export interface PreviewRepairWorkItem {
  listingId: string;
  title: string;
  identityKey: string;
  sources: PreviewImageSource[];
  oldPublicIds: string[];
  previewPackId: string;
  dealerId: string;
  dealerKey: string;
  sourceRunId: string;
  expectedPhotoRevision: number;
}

export function matchArchivePreviewRepairItems(input: {
  dealerKey: string;
  vehicles: Array<{
    identityKey: string;
    title: string;
    pricePence: number;
    mileage: string | null;
    sources: PreviewImageSource[];
  }>;
  listings: PreviewRepairListing[];
}): { items: PreviewRepairWorkItem[]; skipped: Array<{ title: string; reason: string }> } {
  const actions = planPreviewPackResume({
    dealerKey: input.dealerKey,
    vehicles: input.vehicles.map((vehicle) => ({
      ...vehicle,
      sourceCount: vehicle.sources.length,
    })),
    listings: input.listings,
  });
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.identityKey, vehicle]));
  const listings = new Map(input.listings.map((listing) => [listing.id, listing]));
  const items: PreviewRepairWorkItem[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];
  for (const action of actions) {
    const vehicle = vehicles.get(action.identityKey);
    if (!vehicle) continue;
    if (action.kind === "create") {
      skipped.push({ title: vehicle.title, reason: "no-listing" });
      continue;
    }
    if (action.kind === "skip") {
      skipped.push({ title: vehicle.title, reason: action.reason });
      continue;
    }
    const listing = listings.get(action.listingId);
    if (!listing) {
      skipped.push({ title: vehicle.title, reason: "no-listing" });
      continue;
    }
    if (vehicle.sources.length === 0) {
      skipped.push({ title: vehicle.title, reason: "no-sources" });
      continue;
    }
    items.push({
      listingId: listing.id,
      title: listing.title,
      identityKey: vehicle.identityKey,
      sources: vehicle.sources,
      oldPublicIds: listing.images.map((image) => image.publicId),
      previewPackId: listing.previewPackId,
      dealerId: listing.dealerId,
      dealerKey: input.dealerKey,
      sourceRunId: "",
      expectedPhotoRevision: listing.photoRevision,
    });
  }
  return { items, skipped };
}

export function matchOceanPreviewRepairItems(input: {
  listings: PreviewRepairListing[];
  vehicles: Array<{ title: string; pricePence: number; mileage: string | number; imageUrls: string[] }>;
}): { items: PreviewRepairWorkItem[]; skipped: Array<{ title: string; reason: string }> } {
  const byFingerprint = new Map<string, PreviewRepairListing[]>();
  for (const listing of input.listings) {
    const key = previewListingFingerprint(listing);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), listing]);
  }
  const used = new Set<string>();
  const items: PreviewRepairWorkItem[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];
  const vehicleFingerprintCounts = new Map<string, number>();
  for (const vehicle of input.vehicles) {
    const fingerprint = previewListingFingerprint({
      title: vehicle.title,
      pricePence: vehicle.pricePence,
      mileage: vehicle.mileage == null ? null : String(vehicle.mileage),
    });
    vehicleFingerprintCounts.set(
      fingerprint,
      (vehicleFingerprintCounts.get(fingerprint) ?? 0) + 1,
    );
  }
  for (const vehicle of input.vehicles) {
    const key = previewListingFingerprint({
      title: vehicle.title,
      pricePence: vehicle.pricePence,
      mileage: vehicle.mileage == null ? null : String(vehicle.mileage),
    });
    if ((vehicleFingerprintCounts.get(key) ?? 0) > 1) {
      skipped.push({ title: vehicle.title, reason: "ambiguous-source" });
      continue;
    }
    const candidates = (byFingerprint.get(key) ?? []).filter((listing) => !used.has(listing.id));
    if (candidates.length !== 1) {
      skipped.push({
        title: vehicle.title,
        reason: candidates.length === 0 ? "unmatched" : "ambiguous",
      });
      continue;
    }
    const listing = candidates[0];
    const sources = previewImageSources([], vehicle.imageUrls, FEATURED_LISTING_PHOTO_LIMIT);
    if (sources.length === 0) {
      skipped.push({ title: vehicle.title, reason: "no-sources" });
      continue;
    }
    used.add(listing.id);
    items.push({
      listingId: listing.id,
      title: listing.title,
      identityKey: sanitizePreviewSegment(listing.id),
      sources,
      oldPublicIds: listing.images.map((image) => image.publicId),
      previewPackId: listing.previewPackId,
      dealerId: listing.dealerId,
      dealerKey: OCEAN_DEALER_KEY,
      sourceRunId: "",
      expectedPhotoRevision: listing.photoRevision,
    });
  }
  for (const listing of input.listings) {
    if (!used.has(listing.id)) {
      skipped.push({ title: listing.title, reason: "unmatched-listing" });
    }
  }
  return { items, skipped };
}

export async function swapPreviewListingImages(input: {
  prisma: PrismaClient;
  listingId: string;
  uploaded: PreviewUploadedImage[];
  oldPublicIds: string[];
  previewPackId: string;
  dealerId: string;
  dealerKey: string;
  sourceRunId: string;
  expectedPhotoRevision: number;
  reason: string;
}) {
  const nextIds = new Set(input.uploaded.map((image) => image.publicId));
  const stale = input.oldPublicIds.filter(
    (publicId) => canEnqueuePreviewPackCleanup(publicId) && !nextIds.has(publicId),
  );
  return input.prisma.$transaction(async (tx) => {
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
          select: { publicId: true, order: true },
        },
        revisions: {
          where: { status: { in: ["DRAFT", "PENDING"] } },
          select: { id: true },
        },
      },
    });
    const currentIds = current?.images.map((image) => image.publicId) ?? [];
    if (
      !pack ||
      !current ||
      current.revisions.length > 0 ||
      JSON.stringify(currentIds) !== JSON.stringify(input.oldPublicIds)
    ) {
      return { applied: false, enqueuedCleanup: [] as string[] };
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
    if (claimed.count !== 1) {
      return { applied: false, enqueuedCleanup: [] as string[] };
    }
    await tx.listingImage.deleteMany({ where: { listingId: input.listingId } });
    if (input.uploaded.length > 0) {
      await tx.listingImage.createMany({
        data: input.uploaded.map((image) => ({
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
    }
    if (stale.length > 0) {
      await tx.listingImageCleanupJob.createMany({
        data: stale.map((publicId) => ({
          publicId,
          deliveryType: "private",
          reason: input.reason,
        })),
      });
    }
    return { applied: true, enqueuedCleanup: stale };
  });
}

export async function loadPreviewPackListings(prisma: PrismaClient, dealerKey: string) {
  const pack = await prisma.dealerPreviewPack.findUnique({
    where: { dealerKey },
    select: {
      id: true,
      enabled: true,
      displayName: true,
      sourceRunId: true,
      dealerProfileId: true,
    },
  });
  if (!pack) throw new Error(`Preview pack ${dealerKey} is not loaded.`);
  const listings = await prisma.listing.findMany({
    where: {
      previewPackId: pack.id,
      dealerId: pack.dealerProfileId,
      status: "ADMIN_PREVIEW",
    },
    select: {
      id: true,
      title: true,
      price: true,
      previewPackId: true,
      dealerId: true,
      status: true,
      photoRevision: true,
      images: { select: { publicId: true, order: true }, orderBy: { order: "asc" } },
      attributeValues: {
        where: { attributeDefinition: { slug: "mileage" } },
        select: { value: true },
      },
    },
  });
  return {
    pack,
    listings: listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      pricePence: listing.price,
      mileage: listing.attributeValues[0]?.value ?? null,
      previewPackId: listing.previewPackId ?? "",
      dealerId: listing.dealerId ?? "",
      status: listing.status,
      photoRevision: listing.photoRevision,
      images: listing.images,
    })),
  };
}

export function archivePreviewRepairVehicles(dealerKey: string) {
  const runId = findLatestRunForDealer(dealerKey);
  if (!runId) throw new Error(`Archive not on this host for ${dealerKey}.`);
  return readDealerSnapshot({ dealerKey, runId }).then((snapshot) => ({
    runId,
    vehicles: snapshot.vehicles.flatMap((vehicle) => {
      const mapped = mapReconciledVehicle(vehicle);
      if (!mapped.listing) return [];
      return [{
        identityKey: vehicle.identityKey,
        title: mapped.listing.title,
        pricePence: mapped.listing.pricePence,
        mileage: mapped.listing.attributes.mileage ?? null,
        sources: previewImageSources(vehicle.images, mapped.listing.imageUrls, PREVIEW_PACK_PHOTO_LIMIT),
      }];
    }),
  }));
}

export async function uploadAndSwapPreviewRepairItem(input: {
  prisma: PrismaClient;
  dealerKey: string;
  item: PreviewRepairWorkItem;
  reason: string;
  uploadImages?: typeof uploadPreviewPackImages;
  cleanupImages?: typeof cleanupPreviewUploadedImages;
}) {
  const upload = input.uploadImages ?? uploadPreviewPackImages;
  const cleanup = input.cleanupImages ?? cleanupPreviewUploadedImages;
  const attemptId = randomUUID();
  const uploaded = await upload({
    dealerKey: input.dealerKey,
    identityKey: input.item.identityKey,
    sources: input.item.sources,
    attemptId,
  });
  const minimum = input.item.oldPublicIds.length >= 4 ? 4 : 1;
  if (uploaded.length !== input.item.sources.length || uploaded.length < minimum) {
    await cleanup(uploaded);
    return {
      listingId: input.item.listingId,
      title: input.item.title,
      repaired: false,
      reason: "upload-incomplete",
    };
  }
  const swap = await swapPreviewListingImages({
    prisma: input.prisma,
    listingId: input.item.listingId,
    uploaded,
    oldPublicIds: input.item.oldPublicIds,
    previewPackId: input.item.previewPackId,
    dealerId: input.item.dealerId,
    dealerKey: input.item.dealerKey,
    sourceRunId: input.item.sourceRunId,
    expectedPhotoRevision: input.item.expectedPhotoRevision,
    reason: input.reason,
  });
  if (!swap.applied) {
    await cleanup(uploaded);
    return {
      listingId: input.item.listingId,
      title: input.item.title,
      repaired: false,
      reason: "listing-changed",
    };
  }
  return {
    listingId: input.item.listingId,
    title: input.item.title,
    repaired: true,
    uploaded: uploaded.length,
    enqueuedCleanup: swap.enqueuedCleanup.length,
  };
}

export function previewRepairPhotoLimit(dealerKey: string) {
  return dealerKey === OCEAN_DEALER_KEY ? FEATURED_LISTING_PHOTO_LIMIT : PREVIEW_PACK_PHOTO_LIMIT;
}
