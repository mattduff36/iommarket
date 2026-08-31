import { z } from "zod";
import type { EnrichListing, PlateOverride } from "./enrich-types";
import { usableRegistration } from "./enrich-vrm";

const plateOverrideItemSchema = z.object({
  listingId: z.string().trim().min(1),
  vrm: z.string().trim().min(1),
  evidenceImageUrl: z.string().trim().min(1),
  expectedMake: z.string().trim().min(1).optional(),
  expectedModel: z.string().trim().min(1).optional(),
  expectedYear: z.string().trim().min(1).optional(),
});

const plateOverrideFileSchema = z.object({
  listings: z.array(plateOverrideItemSchema),
});

export class PlateOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlateOverrideError";
  }
}

export function parsePlateOverrideFile(raw: unknown): PlateOverride[] {
  const parsed = plateOverrideFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlateOverrideError("Malformed plate override file.");
  }
  return parsed.data.listings;
}

export function validatePlateOverrides(input: {
  overrides: PlateOverride[];
  listings: EnrichListing[];
}): PlateOverride[] {
  const listingsById = new Map(input.listings.map((listing) => [listing.id, listing]));
  const seenListingIds = new Set<string>();
  const seenVrms = new Set<string>();
  const validated: PlateOverride[] = [];

  for (const override of input.overrides) {
    if (seenListingIds.has(override.listingId)) {
      throw new PlateOverrideError(`Duplicate listing override: ${override.listingId}`);
    }
    seenListingIds.add(override.listingId);

    const listing = listingsById.get(override.listingId);
    if (!listing) {
      throw new PlateOverrideError(`Unknown or non-Ocean listing override: ${override.listingId}`);
    }

    const usable = usableRegistration(override.vrm);
    if (!usable) {
      throw new PlateOverrideError(`Unsupported plate override VRM for ${override.listingId}`);
    }
    if (seenVrms.has(usable)) {
      throw new PlateOverrideError(`Duplicate override VRM for ${override.listingId}`);
    }
    seenVrms.add(usable);

    if (!listing.photoUrls.includes(override.evidenceImageUrl)) {
      throw new PlateOverrideError(
        `Override evidence image does not belong to listing ${override.listingId}`,
      );
    }

    const listingMake = listing.make.trim() || override.expectedMake?.trim() || "";
    const listingModel = listing.model.trim() || override.expectedModel?.trim() || "";
    if (!listing.make.trim() && !override.expectedMake?.trim()) {
      throw new PlateOverrideError(`Override for ${override.listingId} requires expectedMake`);
    }
    if (!listing.model.trim() && !override.expectedModel?.trim()) {
      throw new PlateOverrideError(`Override for ${override.listingId} requires expectedModel`);
    }
    if (!listingMake || !listingModel) {
      throw new PlateOverrideError(`Override for ${override.listingId} is missing expected identity`);
    }

    if (!listing.year.trim() && !override.expectedYear?.trim()) {
      throw new PlateOverrideError(`Override for ${override.listingId} requires expectedYear`);
    }

    validated.push({
      listingId: override.listingId,
      vrm: usable,
      evidenceImageUrl: override.evidenceImageUrl,
      expectedMake: override.expectedMake,
      expectedModel: override.expectedModel,
      expectedYear: override.expectedYear,
    });
  }

  return validated;
}
