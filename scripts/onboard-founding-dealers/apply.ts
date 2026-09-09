import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateExpiryDate } from "../../lib/listing-status";
import { getDealerListingCap } from "../../lib/config/dealer-tiers";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { mapReconciledVehicle, type MappedArchiveListing } from "../dealer-stock-sync/map-listing";
import type { ArchivedVehicle } from "../dealer-stock-sync/types";
import { FOUNDING_PRO_CAP, type FoundingDealer } from "./allowlist";
import { foundingImagePublicId, foundingListingSlug } from "./identity";
import type { FoundingUploadedImage } from "./media";

const ACTIVE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;
const IMPORT_NOTES = "Founding dealer archive import by admin@mpdee.co.uk (administrative, not dealer acceptance).";

export interface CatalogIds {
  categories: Record<string, string>;
  regions: Record<string, string>;
  attributes: Array<{ id: string; slug: string; categoryId: string }>;
}

export interface PlannedFoundingListing {
  identityKey: string;
  slug: string;
  listing: MappedArchiveListing;
  regionSlug: string;
  existing: boolean;
}

export function planFoundingListings(input: {
  dealerKey: string;
  regionSlug: string;
  vehicles: ArchivedVehicle[];
  remainingSlots: number;
  existingSlugs: Set<string>;
}) {
  const mapped = input.vehicles
    .map((vehicle) => ({ vehicle, outcome: mapReconciledVehicle(vehicle) }))
    .filter((item) => item.outcome.listing)
    .sort((a, b) => a.vehicle.identityKey.localeCompare(b.vehicle.identityKey));

  const planned: PlannedFoundingListing[] = [];
  let overflow = 0;
  let skipped = input.vehicles.length - mapped.length;
  for (const item of mapped) {
    const mappedListing = item.outcome.listing!;
    const listing = {
      ...mappedListing,
      imageUrls: mappedListing.imageUrls.slice(0, FEATURED_LISTING_PHOTO_LIMIT),
    };
    const slug = foundingListingSlug(input.dealerKey, item.vehicle.identityKey);
    const existing = input.existingSlugs.has(slug);
    if (!existing && planned.filter((row) => !row.existing).length >= input.remainingSlots) {
      overflow += 1;
      continue;
    }
    planned.push({
      identityKey: item.vehicle.identityKey,
      slug,
      listing,
      regionSlug: input.regionSlug,
      existing,
    });
  }
  skipped += overflow;
  return { planned, overflow, skipped };
}

export async function loadCatalogIds(prisma: PrismaClient | Prisma.TransactionClient): Promise<CatalogIds> {
  const [categories, regions, attributes] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.region.findMany({ select: { id: true, slug: true } }),
    prisma.attributeDefinition.findMany({
      select: { id: true, slug: true, categoryId: true },
    }),
  ]);
  return {
    categories: Object.fromEntries(categories.map((item) => [item.slug, item.id])),
    regions: Object.fromEntries(regions.map((item) => [item.slug, item.id])),
    attributes,
  };
}

export async function loadExistingFoundingSlugs(
  prisma: PrismaClient | Prisma.TransactionClient,
  dealerId: string,
  dealerKey: string,
) {
  const listings = await prisma.listing.findMany({
    where: { dealerId, slug: { startsWith: `fd-${dealerKey}-` } },
    select: {
      id: true,
      slug: true,
      dealerId: true,
      status: true,
      previewPackId: true,
      title: true,
      price: true,
    },
  });
  return listings;
}

export function assertFoundingListingProvenance(input: {
  existing: {
    dealerId: string | null;
    status: string;
    previewPackId: string | null;
    title: string;
    price: number;
  };
  expectedDealerId: string;
  expectedTitle: string;
  expectedPricePence: number;
}) {
  if (input.existing.dealerId !== input.expectedDealerId) {
    throw new Error("Refusing founding onboard: listing dealer mismatch.");
  }
  if (input.existing.previewPackId) {
    throw new Error("Refusing founding onboard: existing listing is linked to a preview pack.");
  }
  if (input.existing.status !== "LIVE") {
    throw new Error("Refusing founding onboard: existing founding listing is not LIVE.");
  }
  if (input.existing.title !== input.expectedTitle || input.existing.price !== input.expectedPricePence) {
    throw new Error("Refusing founding onboard: existing listing content does not match the archive.");
  }
}

export async function countActiveListings(
  prisma: PrismaClient | Prisma.TransactionClient,
  dealerId: string,
) {
  return prisma.listing.count({
    where: { dealerId, status: { in: [...ACTIVE_STATUSES] } },
  });
}

export async function resolveFoundingListingPlan(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    dealer: FoundingDealer;
    vehicles: ArchivedVehicle[];
  },
) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: input.dealer.email, mode: "insensitive" } },
    select: {
      id: true,
      dealerProfile: { select: { id: true, isAdminPreview: true } },
    },
  });
  const profile = user?.dealerProfile ?? null;
  if (profile?.isAdminPreview) {
    throw new Error("Refusing founding onboard: cannot attach listings to an admin preview dealer.");
  }
  const existingListings = profile ? await loadExistingFoundingSlugs(prisma, profile.id, input.dealer.key) : [];
  const existingBySlug = new Map(existingListings.map((item) => [item.slug, item]));
  const planned = planFoundingListings({
    dealerKey: input.dealer.key,
    regionSlug: input.dealer.regionSlug,
    vehicles: input.vehicles,
    remainingSlots: remainingFoundingSlots(profile ? await countActiveListings(prisma, profile.id) : 0),
    existingSlugs: new Set(existingListings.map((item) => item.slug).filter(Boolean) as string[]),
  });
  for (const item of planned.planned.filter((row) => row.existing)) {
    const existing = existingBySlug.get(item.slug);
    if (!existing || !profile) {
      throw new Error("Refusing founding onboard: existing founding slug is missing.");
    }
    assertFoundingListingProvenance({
      existing,
      expectedDealerId: profile.id,
      expectedTitle: item.listing.title,
      expectedPricePence: item.listing.pricePence,
    });
  }
  return planned;
}

export function remainingFoundingSlots(activeCount: number) {
  const cap = getDealerListingCap("PRO");
  if (cap !== FOUNDING_PRO_CAP) {
    throw new Error(`Expected Pro cap ${FOUNDING_PRO_CAP}, found ${cap}`);
  }
  return Math.max(0, cap - activeCount);
}

export async function insertFoundingListing(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dealerId: string;
    adminUserId: string;
    planned: PlannedFoundingListing;
    images: FoundingUploadedImage[];
    catalog: CatalogIds;
    dealer: FoundingDealer;
    now: Date;
  },
) {
  if (input.planned.existing) return { id: null, created: false };
  const slugClash = await tx.listing.findFirst({
    where: { slug: input.planned.slug },
    select: {
      id: true,
      dealerId: true,
      status: true,
      previewPackId: true,
      title: true,
      price: true,
    },
  });
  if (slugClash) {
    assertFoundingListingProvenance({
      existing: slugClash,
      expectedDealerId: input.dealerId,
      expectedTitle: input.planned.listing.title,
      expectedPricePence: input.planned.listing.pricePence,
    });
    return { id: slugClash.id, created: false };
  }
  const categoryId = input.catalog.categories[input.planned.listing.categorySlug];
  const regionId = input.catalog.regions[input.planned.regionSlug];
  if (!categoryId) throw new Error(`Missing category ${input.planned.listing.categorySlug}`);
  if (!regionId) throw new Error(`Missing region ${input.planned.regionSlug}`);

  const created = await tx.listing.create({
    data: {
      userId: input.userId,
      dealerId: input.dealerId,
      categoryId,
      regionId,
      title: input.planned.listing.title,
      description: input.planned.listing.description,
      price: input.planned.listing.pricePence,
      status: "LIVE",
      featured: false,
      slug: input.planned.slug,
      previewPackId: null,
      expiresAt: calculateExpiryDate(input.now),
      trustDeclarationAccepted: true,
      trustDeclarationAcceptedAt: input.now,
    },
  });

  const attrIds = Object.fromEntries(
    input.catalog.attributes
      .filter((item) => item.categoryId === categoryId)
      .map((item) => [item.slug, item.id]),
  );
  await tx.listingAttributeValue.createMany({
    data: Object.entries(input.planned.listing.attributes)
      .filter(([slug]) => attrIds[slug])
      .map(([slug, value]) => ({
        listingId: created.id,
        attributeDefinitionId: attrIds[slug],
        value,
      })),
  });

  if (input.images.length > 0) {
    await tx.listingImage.createMany({
      data: input.images.map((image, order) => ({
        listingId: created.id,
        url: image.url,
        publicId: image.publicId || foundingImagePublicId(input.dealer.key, input.planned.slug, order),
        order,
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

  await tx.listingStatusEvent.createMany({
    data: [
      {
        listingId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
        source: "ADMIN",
        action: "SYSTEM_BACKFILL",
        changedByUserId: input.adminUserId,
        notes: IMPORT_NOTES,
      },
      {
        listingId: created.id,
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        source: "ADMIN",
        action: "SUBMIT",
        changedByUserId: input.adminUserId,
        notes: IMPORT_NOTES,
      },
      {
        listingId: created.id,
        fromStatus: "PENDING",
        toStatus: "LIVE",
        source: "ADMIN",
        action: "APPROVE",
        changedByUserId: input.adminUserId,
        notes: IMPORT_NOTES,
      },
    ],
  });

  return { id: created.id, created: true };
}

export { IMPORT_NOTES, ACTIVE_STATUSES };
