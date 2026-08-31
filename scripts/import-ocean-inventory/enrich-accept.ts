import { z } from "zod";
import { ENRICHABLE_STATUSES, type EnrichListing } from "./enrich-types";

const acceptModelMismatchFileSchema = z
  .object({
    listingIds: z.array(z.string()).min(1),
  })
  .strict();

export class AcceptModelMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptModelMismatchError";
  }
}

export function requireAcceptModelMismatchPath(argv: string[]) {
  const index = argv.indexOf("--accept-model-mismatch");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new AcceptModelMismatchError("--accept-model-mismatch requires a JSON file path.");
  }
  return value;
}

export function parseAcceptModelMismatchFile(raw: unknown): string[] {
  const parsed = acceptModelMismatchFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AcceptModelMismatchError("Malformed accept-model-mismatch file.");
  }

  const listingIds: string[] = [];
  const seen = new Set<string>();
  for (const value of parsed.data.listingIds) {
    const listingId = value.trim();
    if (!listingId) {
      throw new AcceptModelMismatchError("Accept-model-mismatch listing IDs must be non-empty.");
    }
    if (seen.has(listingId)) {
      throw new AcceptModelMismatchError(`Duplicate accept-model-mismatch listing ID: ${listingId}`);
    }
    seen.add(listingId);
    listingIds.push(listingId);
  }
  return listingIds;
}

export function validateAcceptModelMismatchIds(input: {
  listingIds: string[];
  listings: EnrichListing[];
}): string[] {
  const eligible = new Map(input.listings.map((listing) => [listing.id, listing]));
  for (const listingId of input.listingIds) {
    const listing = eligible.get(listingId);
    if (!listing || !(ENRICHABLE_STATUSES as readonly string[]).includes(listing.status)) {
      throw new AcceptModelMismatchError(
        `Unknown or ineligible listing ID in accept-model-mismatch: ${listingId}`,
      );
    }
  }
  return input.listingIds;
}
