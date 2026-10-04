export interface SourceInventoryRecord {
  assetId: string;
  publicId: string;
  version: string;
  bytes: number;
  format: string;
  resourceType: string;
  width: number | null;
  height: number | null;
  tags: string[];
  hasContext: boolean;
}

export interface MappedOriginal {
  assetId: string;
  sourcePublicId: string;
  sourceVersion: string;
  destinationFileId: string;
  destinationPath: string;
  sourceBytes: number;
  sourceSha256: string;
}

export interface ReconciliationDelta {
  status: "pass2-not-available" | "dry-run";
  added: SourceInventoryRecord[];
  replaced: Array<{ previous: MappedOriginal; current: SourceInventoryRecord }>;
  missingFromPass: MappedOriginal[];
  unchanged: number;
  deletionsProposed: 0;
}

interface InventoryRow {
  asset_id?: unknown;
  public_id?: unknown;
  version?: unknown;
  bytes?: unknown;
  format?: unknown;
  resource_type?: unknown;
  width?: unknown;
  height?: unknown;
  tags?: unknown;
  context?: unknown;
}

export function sourceRecordFromInventory(row: InventoryRow): SourceInventoryRecord {
  if (typeof row.asset_id !== "string" || typeof row.public_id !== "string" || row.version == null) {
    throw new Error("Inventory row is missing an asset identity.");
  }
  return {
    assetId: row.asset_id,
    publicId: row.public_id,
    version: String(row.version),
    bytes: Number(row.bytes ?? 0),
    format: String(row.format ?? ""),
    resourceType: String(row.resource_type ?? ""),
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    hasContext: Boolean(row.context && typeof row.context === "object" && Object.keys(row.context).length > 0),
  };
}

export function reconcileSourceSnapshot(input: {
  pass2Available: boolean;
  baseline: readonly MappedOriginal[];
  pass2: readonly SourceInventoryRecord[];
}): ReconciliationDelta {
  if (!input.pass2Available) {
    return {
      status: "pass2-not-available",
      added: [],
      replaced: [],
      missingFromPass: [],
      unchanged: 0,
      deletionsProposed: 0,
    };
  }

  const baselineByAsset = new Map(input.baseline.map((item) => [item.assetId, item]));
  const baselineByPublicVersion = new Map(
    input.baseline.map((item) => [`${item.sourcePublicId}\n${item.sourceVersion}`, item]),
  );
  const seenAssets = new Set<string>();
  const added: SourceInventoryRecord[] = [];
  const replaced: ReconciliationDelta["replaced"] = [];
  let unchanged = 0;

  for (const current of input.pass2) {
    seenAssets.add(current.assetId);
    const byAsset = baselineByAsset.get(current.assetId);
    const byVersion = baselineByPublicVersion.get(`${current.publicId}\n${current.version}`);
    const previous = byAsset ?? byVersion;
    if (!previous) {
      added.push(current);
      continue;
    }
    if (previous.sourceVersion !== current.version || previous.sourceBytes !== current.bytes) {
      replaced.push({ previous, current });
      continue;
    }
    unchanged += 1;
  }

  const missingFromPass = input.baseline.filter((item) => !seenAssets.has(item.assetId) && !input.pass2.some(
    (current) => current.publicId === item.sourcePublicId && current.version === item.sourceVersion,
  ));

  return {
    status: "dry-run",
    added,
    replaced,
    missingFromPass,
    unchanged,
    deletionsProposed: 0,
  };
}
