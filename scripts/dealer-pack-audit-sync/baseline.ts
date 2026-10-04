import type { PackBaseline } from "./types";

export interface LivePackBaselineInput {
  id: string;
  dealerProfileId: string;
  sourceRunId: string;
  enabled: boolean;
  updatedAt: Date | string;
  listings: Array<{
    id: string;
    userId: string;
    dealerId: string | null;
    previewPackId: string | null;
    status: string;
    lifecycleRevision: number;
    photoRevision: number;
    updatedAt: Date | string;
    images: Array<{
      id: string;
      publicId: string;
      order: number;
      provider: "CLOUDINARY" | "EXTERNAL" | "IMAGEKIT";
    }>;
    revisions: Array<{ id: string; status: string; updatedAt: Date | string }>;
  }>;
}

export const PACK_BASELINE_SELECT = {
  id: true,
  dealerProfileId: true,
  sourceRunId: true,
  enabled: true,
  updatedAt: true,
  listings: {
    orderBy: { id: "asc" as const },
    select: {
      id: true,
      userId: true,
      dealerId: true,
      previewPackId: true,
      status: true,
      lifecycleRevision: true,
      photoRevision: true,
      updatedAt: true,
      images: {
        orderBy: [{ order: "asc" as const }, { id: "asc" as const }],
        select: { id: true, publicId: true, order: true, provider: true },
      },
      revisions: {
        orderBy: { id: "asc" as const },
        select: { id: true, status: true, updatedAt: true },
      },
    },
  },
};

export function capturePackBaseline(pack: LivePackBaselineInput): PackBaseline {
  return {
    packId: pack.id,
    dealerProfileId: pack.dealerProfileId,
    sourceRunId: pack.sourceRunId,
    enabled: pack.enabled,
    updatedAt: new Date(pack.updatedAt).toISOString(),
    listings: [...pack.listings]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((listing) => ({
        id: listing.id,
        userId: listing.userId,
        dealerId: listing.dealerId,
        previewPackId: listing.previewPackId,
        status: listing.status,
        lifecycleRevision: listing.lifecycleRevision,
        photoRevision: listing.photoRevision,
        updatedAt: new Date(listing.updatedAt).toISOString(),
        images: [...listing.images]
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
          .map((image) => ({
            id: image.id,
            publicId: image.publicId,
            order: image.order,
            provider: image.provider,
          })),
        revisions: [...listing.revisions]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((revision) => ({
            id: revision.id,
            status: revision.status,
            updatedAt: new Date(revision.updatedAt).toISOString(),
          })),
      })),
  };
}

export function baselineDifferences(
  expected: PackBaseline,
  current: PackBaseline,
  options: { ignorePackEnabledAndUpdatedAt?: boolean } = {},
) {
  const differences: string[] = [];
  const compare = (
    key: string,
    expectedValue: unknown,
    currentValue: unknown,
  ) => {
    if (JSON.stringify(expectedValue) !== JSON.stringify(currentValue)) {
      differences.push(key);
    }
  };
  compare("packId", expected.packId, current.packId);
  compare("dealerProfileId", expected.dealerProfileId, current.dealerProfileId);
  compare("sourceRunId", expected.sourceRunId, current.sourceRunId);
  if (!options.ignorePackEnabledAndUpdatedAt) {
    compare("enabled", expected.enabled, current.enabled);
    compare("packUpdatedAt", expected.updatedAt, current.updatedAt);
  }
  compare("listings", expected.listings, current.listings);
  return differences;
}

export function assertBaselineMatches(
  expected: PackBaseline,
  current: PackBaseline,
  options?: { ignorePackEnabledAndUpdatedAt?: boolean },
) {
  const differences = baselineDifferences(expected, current, options);
  if (differences.length > 0) {
    throw new Error(
      `Refusing audit sync: preview pack baseline changed (${differences.join(", ")}).`,
    );
  }
}
