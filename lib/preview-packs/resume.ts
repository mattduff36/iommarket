import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";

export function sanitizePreviewSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function previewListingFingerprint(input: {
  title: string;
  pricePence: number;
  mileage: string | null;
}) {
  return `${input.title.trim().toLowerCase()}|${input.pricePence}|${input.mileage ?? ""}`;
}

export function identityKeyFromPreviewPublicId(publicId: string, dealerKey: string) {
  const prefix = `${IMAGE_CONSTRAINTS.folder}/preview-packs/${sanitizePreviewSegment(dealerKey)}/`;
  if (!publicId.startsWith(prefix)) return null;
  const identityKey = publicId.slice(prefix.length).split("/")[0];
  return identityKey || null;
}

export interface PreviewResumeVehicle {
  identityKey: string;
  title: string;
  pricePence: number;
  mileage: string | null;
  sourceCount: number;
}

export interface PreviewResumeListing {
  id: string;
  title: string;
  pricePence: number;
  mileage: string | null;
  photoRevision: number;
  images: Array<{ publicId: string; order: number }>;
}

export type PreviewResumeAction =
  | { kind: "create"; identityKey: string }
  | {
      kind: "backfill";
      identityKey: string;
      listingId: string;
      missingOrders: number[];
      expectedPhotoRevision: number;
      expectedPublicIds: string[];
    }
  | { kind: "complete"; identityKey: string; listingId: string }
  | { kind: "skip"; identityKey: string; reason: "ambiguous-source" | "ambiguous-listing" };

function missingImageOrders(existingOrders: number[], sourceCount: number) {
  return Array.from({ length: sourceCount }, (_, order) => order).filter(
    (order) => !existingOrders.includes(order),
  );
}

export function planPreviewPackResume(input: {
  dealerKey: string;
  vehicles: PreviewResumeVehicle[];
  listings: PreviewResumeListing[];
}): PreviewResumeAction[] {
  const usedListingIds = new Set<string>();
  const listingsByIdentity = new Map<string, PreviewResumeListing[]>();
  const listingsByFingerprint = new Map<string, PreviewResumeListing[]>();
  const vehicleIdentityCounts = new Map<string, number>();
  const vehicleFingerprintCounts = new Map<string, number>();

  for (const vehicle of input.vehicles) {
    const identity = sanitizePreviewSegment(vehicle.identityKey);
    const fingerprint = previewListingFingerprint(vehicle);
    vehicleIdentityCounts.set(identity, (vehicleIdentityCounts.get(identity) ?? 0) + 1);
    vehicleFingerprintCounts.set(fingerprint, (vehicleFingerprintCounts.get(fingerprint) ?? 0) + 1);
  }

  for (const listing of input.listings) {
    const fingerprint = previewListingFingerprint(listing);
    listingsByFingerprint.set(fingerprint, [
      ...(listingsByFingerprint.get(fingerprint) ?? []),
      listing,
    ]);
    for (const image of listing.images) {
      const identityKey = identityKeyFromPreviewPublicId(image.publicId, input.dealerKey);
      if (identityKey) {
        const existing = listingsByIdentity.get(identityKey) ?? [];
        if (!existing.some((candidate) => candidate.id === listing.id)) {
          listingsByIdentity.set(identityKey, [...existing, listing]);
        }
      }
    }
  }

  const blocked = new Map<number, "ambiguous-source" | "ambiguous-listing">();
  const assigned = new Map<number, PreviewResumeListing>();
  const exactClaims = new Map<string, number[]>();

  input.vehicles.forEach((vehicle, index) => {
    const identityKey = sanitizePreviewSegment(vehicle.identityKey);
    const fingerprint = previewListingFingerprint(vehicle);
    if (
      (vehicleIdentityCounts.get(identityKey) ?? 0) > 1 ||
      (vehicleFingerprintCounts.get(fingerprint) ?? 0) > 1
    ) {
      blocked.set(index, "ambiguous-source");
      return;
    }
    const candidates = listingsByIdentity.get(identityKey) ?? [];
    if (candidates.length > 1) {
      blocked.set(index, "ambiguous-listing");
      return;
    }
    const candidate = candidates[0];
    if (candidate) {
      exactClaims.set(candidate.id, [...(exactClaims.get(candidate.id) ?? []), index]);
    }
  });

  for (const [listingId, claimers] of exactClaims) {
    if (claimers.length > 1) {
      claimers.forEach((index) => blocked.set(index, "ambiguous-listing"));
      continue;
    }
    const index = claimers[0]!;
    const listing = input.listings.find((candidate) => candidate.id === listingId);
    if (listing) {
      assigned.set(index, listing);
      usedListingIds.add(listing.id);
    }
  }

  input.vehicles.forEach((vehicle, index) => {
    if (blocked.has(index) || assigned.has(index)) return;
    const candidates = (listingsByFingerprint.get(previewListingFingerprint(vehicle)) ?? [])
      .filter((candidate) => !usedListingIds.has(candidate.id));
    if (candidates.length > 1) {
      blocked.set(index, "ambiguous-listing");
      return;
    }
    const candidate = candidates[0];
    if (candidate) {
      assigned.set(index, candidate);
      usedListingIds.add(candidate.id);
    }
  });

  return input.vehicles.map((vehicle, index) => {
    const reason = blocked.get(index);
    if (reason) {
      return { kind: "skip" as const, identityKey: vehicle.identityKey, reason };
    }
    const listing = assigned.get(index);
    if (!listing) {
      return { kind: "create" as const, identityKey: vehicle.identityKey };
    }
    const missingOrders = missingImageOrders(
      listing.images.map((image) => image.order),
      vehicle.sourceCount,
    );
    if (missingOrders.length === 0) {
      return {
        kind: "complete" as const,
        identityKey: vehicle.identityKey,
        listingId: listing.id,
      };
    }
    return {
      kind: "backfill" as const,
      identityKey: vehicle.identityKey,
      listingId: listing.id,
      missingOrders,
      expectedPhotoRevision: listing.photoRevision,
      expectedPublicIds: listing.images
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((image) => image.publicId),
    };
  });
}

export function summarizePreviewResumePlan(actions: PreviewResumeAction[]) {
  return {
    create: actions.filter((action) => action.kind === "create").length,
    backfill: actions.filter((action) => action.kind === "backfill").length,
    complete: actions.filter((action) => action.kind === "complete").length,
    skipped: actions.filter((action) => action.kind === "skip").length,
    missingImages: actions.reduce(
      (sum, action) => sum + (action.kind === "backfill" ? action.missingOrders.length : 0),
      0,
    ),
  };
}
