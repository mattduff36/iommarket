import type { Prisma, PrismaClient } from "@prisma/client";
import { buildListingPhotoUrl, buildCanonicalListingImageUrl } from "../../lib/images/cloudinary-url";
import type { ListingPhotoSource } from "../../lib/images/photo";
import { ENRICH_APPROVED_SLUGS, ENRICHABLE_STATUSES, type EnrichListing } from "./enrich-types";
import { isBlankAttribute } from "./enrich-merge";
import { IMPORT_DEALER_NAME } from "./target";
import { verifySnapshot } from "./enrich-snapshot";
import type { EnrichSnapshot } from "./enrich-types";

export class EnrichApplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichApplyConflictError";
  }
}

const approvedSlugSet = new Set<string>(ENRICH_APPROVED_SLUGS);

function listingPhotoUrls(photo: ListingPhotoSource) {
  const urls = [photo.url, buildCanonicalListingImageUrl(photo)];
  try {
    urls.push(
      buildListingPhotoUrl(photo, {
        width: 1200,
        mode: "fit",
        frame: "card",
      }),
    );
  } catch {
    // Photo URL builders need a trusted publicId; stored url is enough.
  }
  return [...new Set(urls.filter((url) => url.trim()))];
}

export function listingEvidenceUrls(listing: Pick<EnrichListing, "photos" | "photoUrls">) {
  const urls = [...listing.photoUrls];
  for (const photo of listing.photos) {
    urls.push(
      ...listingPhotoUrls({
        url: photo.url,
        publicId: photo.publicId,
        provider: photo.provider as ListingPhotoSource["provider"],
        version: photo.version,
        format: photo.format,
      }),
    );
  }
  return [...new Set(urls)];
}

export async function loadEnrichableListings(
  prisma: PrismaClient,
  dealerId: string,
): Promise<EnrichListing[]> {
  const listings = await prisma.listing.findMany({
    where: { dealerId, status: { in: [...ENRICHABLE_STATUSES] } },
    select: {
      id: true,
      title: true,
      dealerId: true,
      status: true,
      categoryId: true,
      price: true,
      category: { select: { slug: true } },
      attributeValues: {
        select: {
          id: true,
          value: true,
          attributeDefinitionId: true,
          attributeDefinition: { select: { slug: true, id: true, name: true, dataType: true, required: true, options: true, categoryId: true } },
        },
      },
      images: {
        orderBy: { order: "asc" },
        select: {
          url: true,
          publicId: true,
          provider: true,
          version: true,
          format: true,
          order: true,
        },
      },
    },
  });

  const definitions = await prisma.attributeDefinition.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      dataType: true,
      required: true,
      options: true,
      categoryId: true,
    },
  });

  return listings.map((listing) => {
    const attrs = Object.fromEntries(
      listing.attributeValues.map((item) => [item.attributeDefinition.slug, item.value]),
    );
    const categoryDefinitions = definitions
      .filter((definition) => definition.categoryId === listing.categoryId)
      .map((definition) => ({
        id: definition.id,
        slug: definition.slug,
        name: definition.name,
        dataType: definition.dataType,
        required: definition.required,
        options: definition.options,
      }));
    const photos = listing.images.map((image) => ({
      url: image.url,
      publicId: image.publicId,
      provider: image.provider,
      version: image.version,
      format: image.format,
      order: image.order,
    }));
    const enrichListing: EnrichListing = {
      id: listing.id,
      title: listing.title,
      dealerId: listing.dealerId ?? dealerId,
      status: listing.status as EnrichListing["status"],
      categoryId: listing.categoryId,
      categorySlug: listing.category.slug,
      pricePence: listing.price,
      year: attrs.year ?? "",
      make: attrs.make ?? "",
      model: attrs.model ?? "",
      mileage: attrs.mileage ?? "",
      attributes: attrs,
      attributeRows: listing.attributeValues.map((item) => ({
        id: item.id,
        attributeDefinitionId: item.attributeDefinitionId,
        slug: item.attributeDefinition.slug,
        value: item.value,
      })),
      photos,
      photoUrls: [],
      definitions: categoryDefinitions,
    };
    return { ...enrichListing, photoUrls: listingEvidenceUrls(enrichListing) };
  });
}

type ApplyClient = PrismaClient | Prisma.TransactionClient;

async function applySnapshotOperations(tx: ApplyClient, snapshot: EnrichSnapshot) {
  const dealer = await tx.dealerProfile.findUnique({
    where: { id: snapshot.dealerId },
    select: { id: true, name: true },
  });
  if (!dealer || dealer.name.trim() !== IMPORT_DEALER_NAME) {
    throw new EnrichApplyConflictError("Ocean Motor Village dealer mismatch.");
  }

  for (const listingPlan of snapshot.listings) {
    const listing = await tx.listing.findUnique({
      where: { id: listingPlan.listingId },
      select: {
        id: true,
        dealerId: true,
        status: true,
        categoryId: true,
        attributeValues: {
          select: { id: true, attributeDefinitionId: true, value: true },
        },
      },
    });
    if (!listing) throw new EnrichApplyConflictError(`Listing missing: ${listingPlan.listingId}`);
    if (listing.dealerId !== snapshot.dealerId) {
      throw new EnrichApplyConflictError(`Listing dealer mismatch: ${listingPlan.listingId}`);
    }
    if (!ENRICHABLE_STATUSES.includes(listing.status as EnrichListing["status"])) {
      throw new EnrichApplyConflictError(`Listing status mismatch: ${listingPlan.listingId}`);
    }
    if (listing.categoryId !== listingPlan.categoryId) {
      throw new EnrichApplyConflictError(`Listing category mismatch: ${listingPlan.listingId}`);
    }

    for (const operation of listingPlan.operations) {
      const definition = await tx.attributeDefinition.findUnique({
        where: { id: operation.attributeDefinitionId },
        select: { id: true, slug: true, categoryId: true },
      });
      if (
        !definition ||
        definition.categoryId !== listing.categoryId ||
        !approvedSlugSet.has(definition.slug) ||
        definition.slug !== operation.slug
      ) {
        throw new EnrichApplyConflictError(
          `Attribute ownership mismatch for ${listingPlan.listingId} ${operation.slug}`,
        );
      }

      const current = listing.attributeValues.find(
        (row) => row.attributeDefinitionId === operation.attributeDefinitionId,
      );
      if (operation.existed) {
        if (!current) {
          throw new EnrichApplyConflictError(`Expected blank row missing for ${operation.slug}`);
        }
        if (current.value !== (operation.beforeValue ?? "")) {
          throw new EnrichApplyConflictError(`Stale attribute value for ${operation.slug}`);
        }
        if (!isBlankAttribute(current.value)) {
          throw new EnrichApplyConflictError(`Refusing to overwrite ${operation.slug}`);
        }
        const updated = await tx.listingAttributeValue.updateMany({
          where: {
            listingId: listing.id,
            attributeDefinitionId: operation.attributeDefinitionId,
            value: operation.beforeValue ?? "",
          },
          data: { value: operation.afterValue },
        });
        if (updated.count !== 1) {
          throw new EnrichApplyConflictError(`Stale attribute value for ${operation.slug}`);
        }
      } else {
        if (current) {
          throw new EnrichApplyConflictError(`Uniqueness conflict creating ${operation.slug}`);
        }
        try {
          await tx.listingAttributeValue.create({
            data: {
              listingId: listing.id,
              attributeDefinitionId: operation.attributeDefinitionId,
              value: operation.afterValue,
            },
          });
        } catch {
          throw new EnrichApplyConflictError(`Uniqueness conflict creating ${operation.slug}`);
        }
      }
    }
  }
}

export async function applyEnrichmentSnapshot(
  prisma: PrismaClient,
  snapshot: EnrichSnapshot,
  expectedDealerId?: string,
) {
  verifySnapshot(snapshot, expectedDealerId);
  await prisma.$transaction(
    async (tx) => {
      await applySnapshotOperations(tx, snapshot);
    },
    { isolationLevel: "Serializable" },
  );
}

async function rollbackSnapshotOperations(tx: ApplyClient, snapshot: EnrichSnapshot) {
  const dealer = await tx.dealerProfile.findUnique({
    where: { id: snapshot.dealerId },
    select: { id: true, name: true },
  });
  if (!dealer || dealer.name.trim() !== IMPORT_DEALER_NAME) {
    throw new EnrichApplyConflictError("Ocean Motor Village dealer mismatch.");
  }

  for (const listingPlan of snapshot.listings) {
    const listing = await tx.listing.findUnique({
      where: { id: listingPlan.listingId },
      select: {
        id: true,
        dealerId: true,
        categoryId: true,
        attributeValues: {
          select: { attributeDefinitionId: true, value: true },
        },
      },
    });
    if (!listing || listing.dealerId !== snapshot.dealerId) {
      throw new EnrichApplyConflictError(`Rollback listing mismatch: ${listingPlan.listingId}`);
    }

    for (const operation of listingPlan.operations) {
      const definition = await tx.attributeDefinition.findUnique({
        where: { id: operation.attributeDefinitionId },
        select: { id: true, slug: true, categoryId: true },
      });
      if (
        !definition ||
        definition.categoryId !== listing.categoryId ||
        !approvedSlugSet.has(definition.slug) ||
        definition.slug !== operation.slug
      ) {
        throw new EnrichApplyConflictError(`Rollback attribute ownership mismatch for ${operation.slug}`);
      }
      const current = listing.attributeValues.find(
        (row) => row.attributeDefinitionId === operation.attributeDefinitionId,
      );
      if (!current || current.value !== operation.afterValue) {
        throw new EnrichApplyConflictError(`Rollback conflict on ${operation.slug}`);
      }
      if (!operation.existed) {
        const deleted = await tx.listingAttributeValue.deleteMany({
          where: {
            listingId: listing.id,
            attributeDefinitionId: operation.attributeDefinitionId,
            value: operation.afterValue,
          },
        });
        if (deleted.count !== 1) {
          throw new EnrichApplyConflictError(`Rollback conflict on ${operation.slug}`);
        }
        continue;
      }
      const restored = await tx.listingAttributeValue.updateMany({
        where: {
          listingId: listing.id,
          attributeDefinitionId: operation.attributeDefinitionId,
          value: operation.afterValue,
        },
        data: { value: operation.beforeValue ?? "" },
      });
      if (restored.count !== 1) {
        throw new EnrichApplyConflictError(`Rollback conflict on ${operation.slug}`);
      }
    }
  }
}

export async function rollbackEnrichmentSnapshot(
  prisma: PrismaClient,
  snapshot: EnrichSnapshot,
  expectedDealerId?: string,
) {
  verifySnapshot(snapshot, expectedDealerId);
  await prisma.$transaction(
    async (tx) => {
      await rollbackSnapshotOperations(tx, snapshot);
    },
    { isolationLevel: "Serializable" },
  );
}
