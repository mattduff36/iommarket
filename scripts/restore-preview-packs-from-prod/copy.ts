import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertNotOceanDealerProfile,
  assertPreviewDealerAllowed,
  OCEAN_OWNER_EMAIL,
} from "../../lib/preview-packs/safety";
import { registryGroupKey } from "../../lib/preview-packs/archive";
import type { DestCatalog, RestorePlan, SourcePack } from "./plan";
import { planRestore } from "./plan";

export async function loadDestCatalog(db: PrismaClient): Promise<DestCatalog> {
  const [categories, regions, attributes] = await Promise.all([
    db.category.findMany({ select: { id: true, slug: true } }),
    db.region.findMany({ select: { id: true, slug: true } }),
    db.attributeDefinition.findMany({
      select: { id: true, slug: true, categoryId: true },
    }),
  ]);
  return { categories, regions, attributes };
}

export async function loadSourcePacks(db: PrismaClient): Promise<SourcePack[]> {
  const packs = await db.dealerPreviewPack.findMany({
    include: {
      dealerProfile: {
        include: {
          user: { select: { email: true, authUserId: true } },
        },
      },
      listings: {
        where: { status: "ADMIN_PREVIEW" },
        include: {
          category: { select: { slug: true } },
          region: { select: { slug: true } },
          images: { orderBy: { order: "asc" } },
          attributeValues: {
            include: { attributeDefinition: { select: { slug: true } } },
          },
        },
      },
    },
    orderBy: { dealerKey: "asc" },
  });
  return packs.map((pack) => ({
    dealerKey: pack.dealerKey,
    displayName: pack.displayName,
    sourceRunId: pack.sourceRunId,
    enabled: pack.enabled,
    website: pack.dealerProfile.website,
    ownerEmail: pack.dealerProfile.user.email,
    ownerAuthUserId: pack.dealerProfile.user.authUserId,
    listings: pack.listings.map((listing) => ({
      id: listing.id,
      status: listing.status,
      title: listing.title,
      description: listing.description,
      price: listing.price,
      categorySlug: listing.category.slug,
      regionSlug: listing.region.slug,
      slug: listing.slug,
      trustDeclarationAccepted: listing.trustDeclarationAccepted,
      trustDeclarationAcceptedAt: listing.trustDeclarationAcceptedAt,
      images: listing.images.map((image) => ({
        publicId: image.publicId,
        url: image.url,
        order: image.order,
        provider: "CLOUDINARY" as const,
        assetId: image.assetId,
        version: image.version,
        width: image.width,
        height: image.height,
        format: image.format,
        bytes: image.bytes,
        focalX: image.focalX,
        focalY: image.focalY,
      })),
      attributes: listing.attributeValues.map((value) => ({
        slug: value.attributeDefinition.slug,
        value: value.value,
      })),
    })),
  }));
}

export async function buildRestorePlan(input: {
  source: PrismaClient;
  dest: PrismaClient;
}) {
  const [sourcePacks, destCatalog] = await Promise.all([
    loadSourcePacks(input.source),
    loadDestCatalog(input.dest),
  ]);
  return planRestore({
    source: { packs: sourcePacks },
    destCatalog,
  });
}

async function ensurePreviewDealer(
  tx: Prisma.TransactionClient,
  input: {
    dealerKey: string;
    displayName: string;
    website: string | null;
    email: string;
    authUserId: string;
    slug: string;
  },
) {
  assertPreviewDealerAllowed({
    dealerKey: input.dealerKey,
    displayName: input.displayName,
    groupKey: registryGroupKey(input.dealerKey),
  });
  const protectedOwner = await tx.user.findFirst({
    where: { email: { equals: OCEAN_OWNER_EMAIL, mode: "insensitive" } },
    select: { dealerProfile: { select: { id: true } } },
  });
  if (protectedOwner?.dealerProfile) {
    const clash = await tx.dealerProfile.findFirst({
      where: { id: protectedOwner.dealerProfile.id, slug: input.slug },
      select: { id: true },
    });
    if (clash) {
      throw new Error("Refuse to attach preview listings to the Ocean dealer profile.");
    }
  }
  const existingReal = await tx.dealerProfile.findFirst({
    where: { slug: input.slug, isAdminPreview: false },
    select: { id: true },
  });
  if (existingReal) {
    throw new Error("A real dealer already uses this preview slug.");
  }
  const user = await tx.user.upsert({
    where: { authUserId: input.authUserId },
    update: { email: input.email, name: input.displayName, role: "DEALER" },
    create: {
      authUserId: input.authUserId,
      email: input.email,
      name: input.displayName,
      role: "DEALER",
    },
  });
  const dealer = await tx.dealerProfile.upsert({
    where: { userId: user.id },
    update: {
      name: input.displayName,
      slug: input.slug,
      website: input.website,
      isAdminPreview: true,
      verified: false,
    },
    create: {
      userId: user.id,
      name: input.displayName,
      slug: input.slug,
      website: input.website,
      isAdminPreview: true,
      verified: false,
    },
  });
  return { userId: user.id, dealerId: dealer.id };
}

export async function applyRestorePlan(input: {
  dest: PrismaClient;
  plan: RestorePlan;
}) {
  const oceanDealer = await input.dest.dealerProfile.findFirst({
    where: { user: { email: { equals: OCEAN_OWNER_EMAIL, mode: "insensitive" } } },
    select: { id: true },
  });
  let createdPacks = 0;
  let createdListings = 0;
  let createdImages = 0;
  let skippedPacks = 0;

  const accountByKey = new Map(input.plan.accounts.map((account) => [account.dealerKey, account]));
  const listingsByKey = new Map<string, RestorePlan["listings"]>();
  for (const listing of input.plan.listings) {
    const rows = listingsByKey.get(listing.dealerKey) ?? [];
    rows.push(listing);
    listingsByKey.set(listing.dealerKey, rows);
  }

  for (const pack of input.plan.packs) {
    const account = accountByKey.get(pack.dealerKey);
    if (!account) continue;
    const result = await input.dest.$transaction(async (tx) => {
      const owners = await ensurePreviewDealer(tx, {
        dealerKey: pack.dealerKey,
        displayName: pack.displayName,
        website: account.website,
        email: account.email,
        authUserId: account.authUserId,
        slug: account.slug,
      });
      assertNotOceanDealerProfile({
        dealerId: owners.dealerId,
        oceanDealerId: oceanDealer?.id,
      });
      const existing = await tx.dealerPreviewPack.findUnique({
        where: { dealerKey: pack.dealerKey },
        include: { _count: { select: { listings: true } } },
      });
      const row =
        existing ??
        (await tx.dealerPreviewPack.create({
          data: {
            dealerKey: pack.dealerKey,
            displayName: pack.displayName,
            sourceRunId: pack.sourceRunId,
            enabled: false,
            dealerProfileId: owners.dealerId,
          },
        }));
      await tx.dealerPreviewPack.update({
        where: { id: row.id },
        data: {
          displayName: pack.displayName,
          sourceRunId: pack.sourceRunId,
          enabled: false,
        },
      });
      if ((existing?._count.listings ?? 0) > 0) {
        return { createdPack: existing ? 0 : 1, listings: 0, images: 0, skipped: 1 };
      }
      let listings = 0;
      let images = 0;
      for (const listing of listingsByKey.get(pack.dealerKey) ?? []) {
        const created = await tx.listing.create({
          data: {
            userId: owners.userId,
            dealerId: owners.dealerId,
            previewPackId: row.id,
            categoryId: listing.categoryId,
            regionId: listing.regionId,
            title: listing.title,
            description: listing.description,
            price: listing.price,
            status: "ADMIN_PREVIEW",
            featured: false,
            slug: listing.slug,
            expiresAt: null,
            trustDeclarationAccepted: listing.trustDeclarationAccepted,
            trustDeclarationAcceptedAt: listing.trustDeclarationAcceptedAt,
          },
        });
        listings += 1;
        if (listing.attributes.length > 0) {
          await tx.listingAttributeValue.createMany({
            data: listing.attributes.map((attribute) => ({
              listingId: created.id,
              attributeDefinitionId: attribute.attributeDefinitionId,
              value: attribute.value,
            })),
          });
        }
        if (listing.images.length > 0) {
          await tx.listingImage.createMany({
            data: listing.images.map((image) => ({
              listingId: created.id,
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
              focalX: image.focalX,
              focalY: image.focalY,
            })),
          });
          images += listing.images.length;
        }
      }
      return {
        createdPack: existing ? 0 : 1,
        listings,
        images,
        skipped: 0,
      };
    });
    createdPacks += result.createdPack;
    createdListings += result.listings;
    createdImages += result.images;
    skippedPacks += result.skipped;
  }

  return { createdPacks, createdListings, createdImages, skippedPacks };
}
