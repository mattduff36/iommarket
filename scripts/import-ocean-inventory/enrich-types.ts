import type { ListingAttributeDefinitionLike } from "../../lib/listings/attribute-ui";
import type { VehicleCheckResult } from "../../lib/services/vehicle-check-types";

export const ENRICH_APPROVED_SLUGS = [
  "make",
  "model",
  "year",
  "fuel-type",
  "colour",
  "engine-size",
  "co2-emissions",
  "tax-per-year",
] as const;

export type EnrichApprovedSlug = (typeof ENRICH_APPROVED_SLUGS)[number];

export const ENRICHABLE_STATUSES = ["LIVE", "APPROVED"] as const;
export type EnrichableStatus = (typeof ENRICHABLE_STATUSES)[number];

export const ENRICH_SNAPSHOT_SCHEMA_VERSION = 1;
export const ENRICH_DEFAULT_LOOKUP_DELAY_MS = 1_000;

export type MatchMethod = "primary" | "secondary" | "override" | null;

export type EnrichReasonCode =
  | "matched-primary"
  | "matched-secondary"
  | "matched-override"
  | "leftover-ambiguous"
  | "leftover-no-vrm"
  | "leftover-vrm-reuse"
  | "leftover-identity-conflict"
  | "leftover-unmatched"
  | "skip-make-mismatch"
  | "skip-model-mismatch"
  | "skip-year-mismatch"
  | "skip-lookup-failed"
  | "skip-no-empty-fields"
  | "skip-unhealthy-sources"
  | "applied";

export interface EnrichListingPhoto {
  url: string;
  publicId: string;
  provider: string;
  version: string | null;
  format: string | null;
  order: number;
}

export interface EnrichListing {
  id: string;
  title: string;
  dealerId: string;
  status: EnrichableStatus;
  categoryId: string;
  categorySlug: string;
  pricePence: number;
  year: string;
  make: string;
  model: string;
  mileage: string;
  attributes: Record<string, string>;
  attributeRows: Array<{
    id: string;
    attributeDefinitionId: string;
    slug: string;
    value: string;
  }>;
  photos: EnrichListingPhoto[];
  photoUrls: string[];
  definitions: ListingAttributeDefinitionLike[];
}

export interface MatchVehicleCandidate {
  id: string;
  year: number | null;
  make: string;
  model: string;
  mileage: number | null;
  pricePence: number | null;
  registration: string | null;
  registrations: string[];
  identityConflict: boolean;
}

export interface ListingMatch {
  listingId: string;
  vehicleId: string | null;
  vrm: string | null;
  vrmMasked: string | null;
  matchMethod: MatchMethod;
  reason: EnrichReasonCode;
}

export interface PlateOverride {
  listingId: string;
  vrm: string;
  evidenceImageUrl: string;
  expectedMake?: string;
  expectedModel?: string;
  expectedYear?: string;
}

export interface SnapshotOperation {
  attributeDefinitionId: string;
  slug: EnrichApprovedSlug;
  existed: boolean;
  beforeValue: string | null;
  afterValue: string;
}

export interface SnapshotListing {
  listingId: string;
  categoryId: string;
  operations: SnapshotOperation[];
}

export interface EnrichSnapshot {
  schemaVersion: number;
  runId: string;
  projectRef: string;
  dealerId: string;
  createdAt: string;
  digest: string;
  listings: SnapshotListing[];
}

export interface ListingPlan {
  listingId: string;
  categoryId: string;
  vrmMasked: string;
  matchMethod: MatchMethod;
  reason: EnrichReasonCode;
  fills: Record<string, string>;
  expectedMake?: string;
  expectedModel?: string;
}

export type LookupFn = (registration: string) => Promise<VehicleCheckResult>;
