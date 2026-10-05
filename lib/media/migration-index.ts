import { readFileSync } from "node:fs";
import { isMigratedDestinationPath } from "@/lib/media/config";

export interface MigrationAsset {
  assetId: string;
  sourcePublicId: string;
  sourceVersion: string;
  destinationFileId: string;
  destinationPath: string;
  resourceType: string;
  format: string;
  sourceBytes: number;
  sourceSha256: string;
  privateVerified: boolean;
}

export interface MigrationIndex {
  byAssetId: Map<string, MigrationAsset>;
  byPublicVersion: Map<string, MigrationAsset>;
  byPublicId: Map<string, MigrationAsset[]>;
  count: number;
}

interface MigrationRow {
  assetId?: unknown;
  sourcePublicId?: unknown;
  sourceVersion?: unknown;
  destinationFileId?: unknown;
  destinationPath?: unknown;
  resourceType?: unknown;
  format?: unknown;
  sourceBytes?: unknown;
  sourceSha256?: unknown;
  privateVerified?: unknown;
}

const cache = new Map<string, MigrationIndex>();

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Migration map is missing ${field}.`);
  }
  return value;
}

export function publicVersionKey(publicId: string, version: string) {
  return `${publicId}\n${version}`;
}

export function migrationAssetFromRow(row: MigrationRow): MigrationAsset {
  const asset: MigrationAsset = {
    assetId: requiredString(row.assetId, "assetId"),
    sourcePublicId: requiredString(row.sourcePublicId, "sourcePublicId"),
    sourceVersion: String(row.sourceVersion ?? ""),
    destinationFileId: requiredString(row.destinationFileId, "destinationFileId"),
    destinationPath: requiredString(row.destinationPath, "destinationPath"),
    resourceType: requiredString(row.resourceType, "resourceType"),
    format: requiredString(row.format, "format"),
    sourceBytes: Number(row.sourceBytes),
    sourceSha256: requiredString(row.sourceSha256, "sourceSha256"),
    privateVerified: row.privateVerified === true,
  };
  if (!asset.sourceVersion || !Number.isFinite(asset.sourceBytes) || asset.sourceBytes < 0) {
    throw new Error("Migration map row has an invalid version or size.");
  }
  if (!isMigratedDestinationPath(asset.destinationPath)) {
    throw new Error("Migration map row is outside the migrated library.");
  }
  return asset;
}

export function buildMigrationIndex(rows: MigrationRow[]): MigrationIndex {
  const index: MigrationIndex = {
    byAssetId: new Map(),
    byPublicVersion: new Map(),
    byPublicId: new Map(),
    count: 0,
  };
  for (const row of rows) {
    const asset = migrationAssetFromRow(row);
    if (index.byAssetId.has(asset.assetId) || index.byPublicVersion.has(publicVersionKey(asset.sourcePublicId, asset.sourceVersion))) {
      throw new Error("Migration map contains a duplicate asset identity.");
    }
    index.byAssetId.set(asset.assetId, asset);
    index.byPublicVersion.set(publicVersionKey(asset.sourcePublicId, asset.sourceVersion), asset);
    const versions = index.byPublicId.get(asset.sourcePublicId) ?? [];
    versions.push(asset);
    index.byPublicId.set(asset.sourcePublicId, versions);
    index.count += 1;
  }
  return index;
}

export function loadMigrationIndex(filePath: string): MigrationIndex {
  const cached = cache.get(filePath);
  if (cached) return cached;
  const rows = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MigrationRow);
  const index = buildMigrationIndex(rows);
  cache.set(filePath, index);
  return index;
}

export function resetMigrationIndexCache() {
  cache.clear();
}
