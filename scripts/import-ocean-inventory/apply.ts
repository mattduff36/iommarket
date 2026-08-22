import { PrismaClient, type Prisma } from "@prisma/client";
import { getDealerListingCap } from "../../lib/config/dealer-tiers";
import { calculateExpiryDate } from "../../lib/listing-status";
import { IMPORT_DEALER_EMAIL, IMPORT_DEALER_NAME, EXPECTED_PRO_CAP } from "./target";
import type { ExistingDealerListing, MappedListing } from "./types";
import type { UploadedListingImage } from "./upload";

const ACTIVE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;

export async function loadImportDealer(prisma: PrismaClient) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: IMPORT_DEALER_EMAIL, mode: "insensitive" } },
    include: {
      dealerProfile: {
        include: {
          subscriptions: true,
        },
      },
    },
  });
  if (!user) throw new Error(`Dealer user not found: ${IMPORT_DEALER_EMAIL}`);
  if (!user.dealerProfile) {
    throw new Error(`Dealer profile missing for ${IMPORT_DEALER_EMAIL}`);
  }
  if (user.dealerProfile.name.trim() !== IMPORT_DEALER_NAME) {
    throw new Error(
      `Expected dealer name ${IMPORT_DEALER_NAME}, found ${user.dealerProfile.name}`,
    );
  }
  if (user.dealerProfile.tier !== "PRO") {
    throw new Error(`Expected Pro dealer, found ${user.dealerProfile.tier}`);
  }
  const cap = getDealerListingCap(user.dealerProfile.tier);
  if (cap !== EXPECTED_PRO_CAP) {
    throw new Error(`Expected Pro cap ${EXPECTED_PRO_CAP}, found ${cap}`);
  }

  const now = new Date();
  const entitled = user.dealerProfile.subscriptions.some((subscription) => {
    if (subscription.source === "PAYMENT") {
      return (
        subscription.status === "ACTIVE" &&
        subscription.currentPeriodEnd != null &&
        subscription.currentPeriodEnd > now
      );
    }
    return (
      subscription.source === "ADMIN_GRANT" &&
      subscription.status === "ACTIVE" &&
      subscription.revokedAt == null &&
      subscription.grantStartsAt != null &&
      subscription.grantEndsAt != null &&
      subscription.grantStartsAt <= now &&
      subscription.grantEndsAt > now
    );
  });
  if (!entitled) {
    throw new Error("Ocean Motor Village has no active dealer entitlement.");
  }

  const activeCount = await prisma.listing.count({
    where: {
      dealerId: user.dealerProfile.id,
      status: { in: [...ACTIVE_STATUSES] },
    },
  });

  return {
    userId: user.id,
    dealerId: user.dealerProfile.id,
    tier: user.dealerProfile.tier,
    cap,
    remainingSlots: Math.max(0, cap - activeCount),
    activeCount,
  };
}

export async function loadExistingDealerIdentities(
  prisma: PrismaClient,
  dealerId: string,
): Promise<ExistingDealerListing[]> {
  const listings = await prisma.listing.findMany({
    where: { dealerId, status: { in: [...ACTIVE_STATUSES] } },
    select: {
      price: true,
      attributeValues: {
        select: {
          value: true,
          attributeDefinition: { select: { slug: true } },
        },
      },
    },
  });

  return listings.map((listing) => {
    const attrs = Object.fromEntries(
      listing.attributeValues.map((item) => [item.attributeDefinition.slug, item.value]),
    );
    return {
      year: attrs.year ?? "",
      make: attrs.make ?? "",
      model: attrs.model ?? "",
      mileage: attrs.mileage ?? "",
      pricePence: listing.price,
    };
  });
}

export async function loadCatalogIds(prisma: PrismaClient) {
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

export async function insertLiveListing(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dealerId: string;
    listing: MappedListing;
    images: UploadedListingImage[];
    catalog: Awaited<ReturnType<typeof loadCatalogIds>>;
  },
) {
  const categoryId = input.catalog.categories[input.listing.categorySlug];
  const regionId = input.catalog.regions[input.listing.regionSlug];
  if (!categoryId) throw new Error(`Missing category ${input.listing.categorySlug}`);
  if (!regionId) throw new Error(`Missing region ${input.listing.regionSlug}`);

  const now = new Date();
  const created = await tx.listing.create({
    data: {
      userId: input.userId,
      dealerId: input.dealerId,
      categoryId,
      regionId,
      title: input.listing.title,
      description: input.listing.description,
      price: input.listing.pricePence,
      status: "LIVE",
      featured: false,
      expiresAt: calculateExpiryDate(now),
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

  await tx.listingStatusEvent.createMany({
    data: [
      {
        listingId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
        source: "ADMIN",
        action: "SYSTEM_BACKFILL",
        notes: "Ocean inventory import",
      },
      {
        listingId: created.id,
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        source: "ADMIN",
        action: "SUBMIT",
        notes: "Ocean inventory import",
      },
      {
        listingId: created.id,
        fromStatus: "PENDING",
        toStatus: "LIVE",
        source: "ADMIN",
        action: "APPROVE",
        notes: "Ocean inventory import",
      },
    ],
  });

  return created.id;
}
