export type DealerStatus =
  | "confirmed"
  | "unverified"
  | "no_public_site"
  | "specialist_optional";

export type SourceStatus =
  | "ok"
  | "failed"
  | "blocked_requires_feed"
  | "no_public_stock"
  | "skipped";

export type VehicleAvailability = "available" | "reserved" | "sold" | "unknown";

export type SnapshotChangeKind =
  | "new"
  | "unchanged"
  | "modified"
  | "missing_after_success"
  | "source_failed";

export type IdentityKind =
  | "sourceVehicleId"
  | "vin"
  | "registration"
  | "stockReference"
  | "detailUrl"
  | "composite";

export type ConnectorKey =
  | "netdirector"
  | "click-dealer"
  | "dragon2000"
  | "autoweb"
  | "dealer-websites"
  | "iomwebdesign"
  | "html-structured"
  | "csv"
  | "unknown";

export interface DealerSourceConfig {
  key: string;
  name: string;
  startUrl: string | null;
  connectorKey: ConnectorKey;
  required: boolean;
  dedicated: boolean;
  notes?: string;
  preferBrowser?: boolean;
  headed?: boolean;
  waitForSelector?: string;
  settleMs?: number;
  maxPages?: number;
}

export interface DealerRecord {
  key: string;
  displayName: string;
  status: DealerStatus;
  website: string | null;
  stockUrls: string[];
  platformHint: string | null;
  connectorKey: ConnectorKey;
  groupKey: string | null;
  locations: string[];
  sources: DealerSourceConfig[];
  notes: string;
  lastVerifiedAt: string | null;
}

export interface CanonicalVehicle {
  dealerKey: string;
  sourceKey: string;
  platform: ConnectorKey;
  sourceVehicleId: string | null;
  registration: string | null;
  vin: string | null;
  stockReference: string | null;
  make: string;
  model: string;
  derivative: string | null;
  year: number | null;
  firstRegistrationDate: string | null;
  mileage: number | null;
  pricePence: number | null;
  isPoa: boolean;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  colour: string | null;
  doors: number | null;
  seats: number | null;
  engineSize: number | null;
  enginePower: number | null;
  vehicleType: string | null;
  description: string;
  locationName: string | null;
  detailUrl: string | null;
  imageUrls: string[];
  availability: VehicleAvailability;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  scrapedAt: string;
  provenance: {
    startUrl: string | null;
    sourceKeys: string[];
    rawIdentityHints: string[];
  };
}

export interface SourceListResult {
  dealerKey: string;
  sourceKey: string;
  platform: ConnectorKey;
  status: SourceStatus;
  error: string | null;
  startUrl: string | null;
  pagesFetched: number;
  advertisedCount: number | null;
  rawCount: number | null;
  vehicles: CanonicalVehicle[];
  rawRecords?: unknown[];
}

export interface ReconciledVehicle {
  identityKey: string;
  identityKind: IdentityKind;
  sources: string[];
  preferredSource: string;
  vehicle: CanonicalVehicle;
  priceMismatch: boolean;
  identityConflict: boolean;
  conflictReason: string | null;
  contentHash: string;
}

export interface ImageArchiveRecord {
  originalUrl: string;
  localPath: string | null;
  contentType: string | null;
  bytes: number | null;
  checksum: string | null;
  status: "ok" | "failed" | "skipped";
  error: string | null;
}

export interface ArchivedVehicle extends ReconciledVehicle {
  importable: boolean;
  importSkipReason: string | null;
  images: ImageArchiveRecord[];
  changeKind?: SnapshotChangeKind;
}

export interface ProbeResult {
  dealerKey: string;
  displayName: string;
  website: string | null;
  stockUrls: string[];
  detectedPlatform: ConnectorKey | null;
  selectedConnector: ConnectorKey;
  status: SourceStatus;
  evidence: string[];
}

export interface PipelineResult {
  dealer: DealerRecord;
  sourceResults: SourceListResult[];
  reconciled: ReconciledVehicle[];
  canArchive: boolean;
  scrapeStartedAt: string;
  scrapeFinishedAt: string;
}
