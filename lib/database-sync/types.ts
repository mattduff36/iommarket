export type SyncMode = "merge" | "replace";

export type SyncJson =
  | null
  | boolean
  | number
  | string
  | SyncJson[]
  | { [key: string]: SyncJson };

export type SyncRow = Record<string, SyncJson>;

export const SYNC_TABLES = [
  "Region",
  "Category",
  "AttributeDefinition",
  "VehicleMake",
  "VehicleModel",
  "VehicleModelAlias",
  "User",
  "DealerProfile",
  "Listing",
  "ListingImage",
  "ListingAttributeValue",
  "ContentPage",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];
export type SyncDataset = Record<SyncTable, SyncRow[]>;

export type ProtectedSyncRows = {
  userIds?: string[];
  dealerProfileIds?: string[];
  listingIds?: string[];
  previewPackDealerProfileIds?: string[];
  sampleCheckoutTargetIds?: string[];
};

export type BlockedDelete = {
  table: SyncTable;
  id: string;
  references: string[];
};

export type SyncOperation = {
  action: "insert" | "update" | "delete" | "preserve" | "skip";
  table: SyncTable;
  key: string;
  before?: SyncRow;
  after?: SyncRow;
  reason?: string;
  archive?: boolean;
};

export type SyncActionCounts = Record<SyncOperation["action"], number>;
export type SyncTableCounts = Record<SyncTable, SyncActionCounts>;

export type DatabaseSyncPlan = {
  mode: SyncMode;
  operations: SyncOperation[];
  counts: SyncTableCounts;
  blockers: string[];
  sourceHash: string;
  destinationHash: string;
  archivedListingIds: string[];
  archivedDealerProfileIds: string[];
  mappedDealerIds: Record<string, string>;
  mappedListingIds: Record<string, string>;
};

export type PlanDatabaseSyncInput = {
  mode: SyncMode;
  source: SyncDataset;
  destination: SyncDataset;
  protected?: ProtectedSyncRows;
  blockedDeletes?: BlockedDelete[];
  archiveBlockedDeletes?: boolean;
  sourceImageOrigins?: Record<string, { provider: "CLOUDINARY" | "EXTERNAL"; publicId: string }>;
};
