import type { CanonicalOceanLocation } from "./locations";
import type { OceanSourceKey } from "./sources";

export type SourceStatus = "ok" | "failed";

export interface NormalizedVehicle {
  sourceKey: OceanSourceKey;
  stockId: string | null;
  registration: string | null;
  stockReference: string | null;
  detailUrl: string | null;
  make: string;
  model: string;
  derivative: string | null;
  year: number | null;
  mileage: number | null;
  pricePence: number | null;
  isPoa: boolean;
  locationName: string;
  vehicleType: string | null;
  description: string;
  imageUrls: string[];
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  colour: string | null;
  doors: number | null;
  seats: number | null;
  engineSize: number | null;
  enginePower: number | null;
}

export interface SourceSearchContext {
  kind?: "vue" | "classic";
  apiUrl: string;
  uuid: string;
  clientToken?: string;
  authorizationHeader?: string;
}

export interface SourceListResult {
  sourceKey: OceanSourceKey;
  status: SourceStatus;
  error: string | null;
  startUrl: string;
  pagesFetched: number;
  rawCount: number | null;
  vehicles: NormalizedVehicle[];
  searchContext?: SourceSearchContext | null;
}

export type IdentityKind =
  | "stockId"
  | "registration"
  | "stockReference"
  | "detailUrl"
  | "composite";

export interface ReconciledVehicle {
  identityKey: string;
  identityKind: IdentityKind;
  sources: OceanSourceKey[];
  preferredSource: OceanSourceKey;
  locationName: CanonicalOceanLocation;
  vehicle: NormalizedVehicle;
  priceMismatch: boolean;
  identityConflict: boolean;
  conflictReason: string | null;
}

export interface MappedListing {
  title: string;
  description: string;
  pricePence: number;
  categorySlug: "car" | "van";
  regionSlug: string;
  attributes: Record<string, string>;
  imageUrls: string[];
  identity: {
    year: number;
    make: string;
    model: string;
    mileage: number;
    pricePence: number;
  };
}

export type MappingSkipReason =
  | "poa"
  | "missing-price"
  | "invalid-price"
  | "missing-required-attr"
  | "invalid-title"
  | "identity-conflict"
  | "detail-missing";

export interface MappingOutcome {
  reconciled: ReconciledVehicle;
  listing: MappedListing | null;
  skipReason: MappingSkipReason | null;
  skipDetail: string | null;
}

export interface ExistingDealerListing {
  year: string;
  make: string;
  model: string;
  mileage: string;
  pricePence: number;
}

export interface ImportReportSource {
  key: OceanSourceKey;
  name: string;
  startUrl: string;
  status: SourceStatus;
  error: string | null;
  pagesFetched: number;
  rawCount: number | null;
  oceanEligibleCount: number;
  excludedCount: number;
  excludedReasons: Array<{ location: string; reason: string; count: number }>;
}

export interface ImportReport {
  scrapeStartedAt: string;
  scrapeFinishedAt: string;
  sources: ImportReportSource[];
  failedSources: Array<{ key: OceanSourceKey; error: string }>;
  successfulRawCount: number;
  successfulEligibleCount: number;
  omvOnly: number;
  dedicatedOnly: number;
  overlap: number;
  duplicateRelationships: Array<{
    identityKey: string;
    sources: OceanSourceKey[];
  }>;
  priceMismatches: number;
  identityConflicts: number;
  detailMissing: number;
  uniqueAfterDedupe: number;
  mappingEligible: number;
  poaSkips: number;
  mappingFailures: number;
  mappingFailureDetails: Array<{
    identityKey: string;
    reason: string;
    detail: string | null;
    title: string;
  }>;
  alreadyPresent: number;
  insertCandidates: number;
  wouldInsert: number;
  proCapLeftovers: number;
  lowerBoundWarning: string | null;
  liveInsertBlockedReason: string | null;
  reconciliationErrors: string[];
}
