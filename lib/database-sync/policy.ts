import type { SyncRow, SyncTable } from "./types";

/** Only these fields may cross the production-to-development boundary. */
export const SYNC_COLUMNS = {
  Region: ["id", "name", "slug", "active", "sortOrder", "createdAt"],
  Category: ["id", "name", "slug", "parentId", "active", "sortOrder", "createdAt"],
  AttributeDefinition: ["id", "categoryId", "name", "slug", "dataType", "required", "options", "sortOrder"],
  VehicleMake: ["id", "name", "normalizedName", "active", "sortOrder", "source", "sourceVersion", "importedAt", "createdAt", "updatedAt"],
  VehicleModel: ["id", "makeId", "name", "normalizedName", "active", "sortOrder", "source", "sourceVersion", "importedAt", "createdAt", "updatedAt"],
  VehicleModelAlias: ["id", "makeId", "modelId", "name", "normalizedName", "active", "sortOrder", "source", "sourceVersion", "importedAt", "createdAt", "updatedAt"],
  User: ["id", "authUserId", "email", "name", "phone", "bio", "avatarUrl", "role", "regionId", "disabledAt", "disabledReason", "disabledReasonCode", "deletedAt", "deletionReason", "deletionRequestedAt", "createdAt", "updatedAt"],
  DealerProfile: ["id", "userId", "name", "slug", "bio", "website", "phone", "logoUrl", "verified", "tier", "isAdminPreview", "createdAt", "updatedAt"],
  Listing: ["id", "userId", "dealerId", "categoryId", "regionId", "title", "description", "price", "status", "featured", "slug", "viewCount", "expiresAt", "soldAt", "trustDeclarationAccepted", "trustDeclarationAcceptedAt", "photoRevision", "lastPhotoMutationId", "lastPhotoMutationHash", "lifecycleRevision", "retentionPurgedAt", "previewPackId", "reviewState", "reviewReasons", "reviewSourceIdentity", "reviewSourceUrl", "approvedAt", "createdAt", "updatedAt"],
  ListingImage: ["id", "listingId", "url", "publicId", "order", "provider", "assetId", "version", "width", "height", "format", "bytes", "uploadIntentId", "focalX", "focalY"],
  ListingAttributeValue: ["id", "listingId", "attributeDefinitionId", "value"],
  ContentPage: ["id", "slug", "title", "markdown", "metaTitle", "metaDescription", "status", "publishedAt", "deletedAt", "createdAt", "updatedAt"],
} as const satisfies Record<SyncTable, readonly string[]>;

/** Fields the read-only source extractor is allowed to fetch before sanitizing rows. */
export const SOURCE_COLUMNS = {
  ...SYNC_COLUMNS,
  User: ["id", "regionId", "disabledAt", "deletedAt", "createdAt", "updatedAt"],
} as const satisfies Record<SyncTable, readonly string[]>;

/** Target-side reads needed for identity/access protections and conflict detection. */
export const DESTINATION_COLUMNS = {
  ...SYNC_COLUMNS,
  User: ["id", "role", "regionId", "createdAt", "updatedAt"],
} as const satisfies Record<SyncTable, readonly string[]>;

export type NaturalIdentity = { table: SyncTable; key: (row: SyncRow) => string | null };

export const NATURAL_IDENTITIES: readonly NaturalIdentity[] = [
  { table: "Region", key: (row) => stringValue(row.slug) },
  { table: "Category", key: (row) => stringValue(row.slug) },
  { table: "AttributeDefinition", key: (row) => pair(stringValue(row.categoryId), stringValue(row.slug)) },
  { table: "VehicleMake", key: (row) => stringValue(row.normalizedName) },
  { table: "VehicleModel", key: (row) => pair(stringValue(row.makeId), stringValue(row.normalizedName)) },
  { table: "VehicleModelAlias", key: (row) => pair(stringValue(row.makeId), stringValue(row.normalizedName)) },
  { table: "User", key: (row) => stringValue(row.id) },
  { table: "DealerProfile", key: (row) => stringValue(row.userId) },
  { table: "Listing", key: (row) => stringValue(row.id) },
  { table: "ListingImage", key: (row) => pair(stringValue(row.provider), stringValue(row.publicId)) },
  { table: "ListingAttributeValue", key: (row) => pair(stringValue(row.listingId), stringValue(row.attributeDefinitionId)) },
  { table: "ContentPage", key: (row) => stringValue(row.slug) },
];

export const PRIMARY_KEYS: Record<SyncTable, (row: SyncRow) => string | null> = {
  Region: (row) => stringValue(row.id),
  Category: (row) => stringValue(row.id),
  AttributeDefinition: (row) => stringValue(row.id),
  VehicleMake: (row) => stringValue(row.id),
  VehicleModel: (row) => stringValue(row.id),
  VehicleModelAlias: (row) => stringValue(row.id),
  User: (row) => stringValue(row.id),
  DealerProfile: (row) => stringValue(row.id),
  Listing: (row) => stringValue(row.id),
  ListingImage: (row) => stringValue(row.id),
  ListingAttributeValue: (row) => stringValue(row.id),
  ContentPage: (row) => stringValue(row.id),
};

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function pair(left: string | null, right: string | null): string | null {
  return left === null || right === null ? null : `${left}\u0000${right}`;
}

export function selectAllowedColumns(table: SyncTable, row: SyncRow): SyncRow {
  return Object.fromEntries(SYNC_COLUMNS[table]
    .filter((column) => Object.hasOwn(row, column))
    .map((column) => [column, row[column]]));
}

export function selectSourceColumns(table: SyncTable, row: SyncRow): SyncRow {
  return Object.fromEntries(SOURCE_COLUMNS[table]
    .filter((column) => Object.hasOwn(row, column))
    .map((column) => [column, row[column]]));
}
