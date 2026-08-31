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
  images: Array<{ publicId: string; order: number }>;
}

export type PreviewResumeAction =
  | { kind: "create"; identityKey: string }
  | { kind: "backfill"; identityKey: string; listingId: string; missingOrders: number[] }
  | { kind: "complete"; identityKey: string; listingId: string };

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
  const listingByIdentity = new Map<string, PreviewResumeListing>();
  const listingsByFingerprint = new Map<string, PreviewResumeListing[]>();

  for (const listing of input.listings) {
    const fingerprint = previewListingFingerprint(listing);
    listingsByFingerprint.set(fingerprint, [
      ...(listingsByFingerprint.get(fingerprint) ?? []),
      listing,
    ]);
    for (const image of listing.images) {
      const identityKey = identityKeyFromPreviewPublicId(image.publicId, input.dealerKey);
      if (identityKey && !listingByIdentity.has(identityKey)) {
        listingByIdentity.set(identityKey, listing);
      }
    }
  }

  return input.vehicles.map((vehicle) => {
    const identityKey = sanitizePreviewSegment(vehicle.identityKey);
    let listing = listingByIdentity.get(identityKey);
    if (listing && usedListingIds.has(listing.id)) listing = undefined;
    if (!listing) {
      const candidates = (listingsByFingerprint.get(previewListingFingerprint(vehicle)) ?? [])
        .filter((candidate) => !usedListingIds.has(candidate.id));
      listing = candidates[0];
    }
    if (!listing) {
      return { kind: "create" as const, identityKey: vehicle.identityKey };
    }
    usedListingIds.add(listing.id);
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
    };
  });
}

export function summarizePreviewResumePlan(actions: PreviewResumeAction[]) {
  return {
    create: actions.filter((action) => action.kind === "create").length,
    backfill: actions.filter((action) => action.kind === "backfill").length,
    complete: actions.filter((action) => action.kind === "complete").length,
    missingImages: actions.reduce(
      (sum, action) => sum + (action.kind === "backfill" ? action.missingOrders.length : 0),
      0,
    ),
  };
}
