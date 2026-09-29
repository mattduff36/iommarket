import type {
  AppliedPackResult,
  PackAuditAction,
  PlannedListing,
} from "./types";
import {
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "../../lib/images/constraints";

export interface LiveExactListing {
  id: string;
  dealerId: string | null;
  title: string;
  description: string;
  price: number;
  status: string;
  category: { slug: string };
  attributeValues: Array<{
    value: string;
    attributeDefinition: { slug: string };
  }>;
  images: Array<{
    publicId: string;
    assetId: string | null;
    order: number;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number | null;
  }>;
}

export interface LiveExactPack {
  dealerProfileId: string;
  sourceRunId: string;
  enabled: boolean;
  listings: LiveExactListing[];
}

function compareListing(
  planned: PlannedListing,
  live: LiveExactListing,
  publicIds: string[],
) {
  const errors: string[] = [];
  const expected = planned.listing;
  if (live.status !== "ADMIN_PREVIEW") errors.push(`${planned.identityKey}:status`);
  if (live.title !== expected.title) errors.push(`${planned.identityKey}:title`);
  if (live.description !== expected.description) errors.push(`${planned.identityKey}:description`);
  if (live.price !== expected.pricePence) errors.push(`${planned.identityKey}:price`);
  if (live.category.slug !== expected.categorySlug) errors.push(`${planned.identityKey}:category`);
  const attributes = Object.fromEntries(
    live.attributeValues.map((item) => [item.attributeDefinition.slug, item.value]),
  );
  if (
    Object.entries(expected.attributes).some(([slug, value]) => attributes[slug] !== value)
  ) {
    errors.push(`${planned.identityKey}:attributes`);
  }
  const ordered = [...live.images].sort((left, right) => left.order - right.order);
  if (
    ordered.length !== publicIds.length ||
    ordered.some((image, index) =>
      image.order !== index || image.publicId !== publicIds[index]
    )
  ) {
    errors.push(`${planned.identityKey}:images`);
  }
  return errors;
}

export function verifyExactPackState(input: {
  action: PackAuditAction;
  applied?: AppliedPackResult;
  live: LiveExactPack | null;
}) {
  const errors: string[] = [];
  if (!input.live) return ["pack-missing"];
  const live = input.live;
  if (live.dealerProfileId !== input.action.baseline.dealerProfileId) {
    errors.push("dealer-profile-changed");
  }
  if (input.action.kind === "disable") {
    if (live.enabled) errors.push("pack-enabled");
    if (input.action.removeListings && live.listings.length !== 0) {
      errors.push("disabled-pack-has-listings");
    }
    return errors;
  }

  if (!live.enabled) errors.push("pack-disabled");
  if (live.sourceRunId !== input.action.sourceRunId) errors.push("source-run");
  if (live.listings.length !== input.action.listings.length) errors.push("listing-count");
  if (!input.applied || input.applied.status !== "applied" || !input.applied.listings) {
    return [...errors, "apply-evidence-missing"];
  }

  const liveById = new Map(live.listings.map((listing) => [listing.id, listing]));
  const plannedByIdentity = new Map(
    input.action.listings.map((listing) => [listing.identityKey, listing]),
  );
  const checksums = new Set<string>();
  const publicIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const evidence of input.applied.listings) {
    const planned = plannedByIdentity.get(evidence.identityKey);
    const listing = liveById.get(evidence.listingId);
    if (!planned || !listing) {
      errors.push(`${evidence.identityKey}:identity`);
      continue;
    }
    if (listing.dealerId !== input.action.baseline.dealerProfileId) {
      errors.push(`${evidence.identityKey}:dealer`);
    }
    errors.push(...compareListing(planned, listing, evidence.publicIds));
    if (
      evidence.sourceChecksums.length !== planned.images.length ||
      evidence.sourceChecksums.some(
        (checksum, index) => checksum !== planned.images[index]?.checksum,
      )
    ) {
      errors.push(`${evidence.identityKey}:checksum-evidence`);
    }
    if (
      evidence.sourceUrls.length !== planned.images.length ||
      evidence.sourceUrls.some(
        (url, index) => url !== planned.images[index]?.sourceUrl,
      )
    ) {
      errors.push(`${evidence.identityKey}:source-url-evidence`);
    }
    if (
      evidence.finalImages.length !== planned.images.length ||
      evidence.finalImages.some((image, index) =>
        image.publicId !== evidence.publicIds[index] ||
        !isAllowedListingImageFormat(image.format) ||
        validateListingImageBounds({
          width: image.width ?? 0,
          height: image.height ?? 0,
          bytes: image.bytes ?? 0,
        }) !== null
      )
    ) {
      errors.push(`${evidence.identityKey}:image-quality-evidence`);
    }
    if (
      listing.images.some((image, index) => {
        const final = evidence.finalImages[index];
        return (
          !final ||
          image.width !== final.width ||
          image.height !== final.height ||
          image.format !== final.format ||
          image.bytes !== final.bytes
        );
      })
    ) {
      errors.push(`${evidence.identityKey}:image-metadata`);
    }
    for (const checksum of evidence.sourceChecksums) {
      if (checksums.has(checksum)) errors.push("duplicate-image-checksum");
      checksums.add(checksum);
    }
    for (const image of listing.images) {
      if (publicIds.has(image.publicId)) errors.push("duplicate-image-public-id");
      publicIds.add(image.publicId);
      if (image.assetId) {
        if (assetIds.has(image.assetId)) errors.push("duplicate-image-asset-id");
        assetIds.add(image.assetId);
      }
    }
  }
  if (input.applied.listings.length !== input.action.listings.length) {
    errors.push("listing-evidence-count");
  }
  return [...new Set(errors)].sort();
}
