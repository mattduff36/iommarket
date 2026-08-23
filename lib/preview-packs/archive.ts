import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { archiveRoot, dealerDir, runDir } from "../../scripts/dealer-stock-sync/archive/paths";
import { getDealer, DEALER_REGISTRY } from "../../scripts/dealer-stock-sync/registry";
import { isExcludedPreviewDealerKey } from "./safety";

export function readLatestArchiveRunId(root?: string) {
  const latestPath = join(archiveRoot(root), "latest.json");
  if (!existsSync(latestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(latestPath, "utf8")) as { runId?: string };
    return parsed.runId?.trim() || null;
  } catch {
    return null;
  }
}

export function listArchivedDealerKeys(runId: string, root?: string) {
  const dir = runDir(archiveRoot(root), runId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "manifest.json")))
    .map((entry) => entry.name);
}

export function listArchiveRunIds(root?: string) {
  const runsDir = join(archiveRoot(root), "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export function findLatestRunForDealer(dealerKey: string, root?: string) {
  for (const runId of listArchiveRunIds(root)) {
    if (existsSync(join(dealerDir(archiveRoot(root), runId, dealerKey), "manifest.json"))) {
      return runId;
    }
  }
  return null;
}

function readManifest(dealerKey: string, runId: string, root?: string) {
  const manifestPath = join(dealerDir(archiveRoot(root), runId, dealerKey), "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dealerKey?: string;
    displayName?: string;
    uniqueVehicles?: number;
    importable?: number;
  };
}

export function registryGroupKey(dealerKey: string) {
  return DEALER_REGISTRY.find((dealer) => dealer.key === dealerKey)?.groupKey ?? null;
}

export interface PreviewArchiveDealer {
  dealerKey: string;
  displayName: string;
  runId: string;
  uniqueVehicles: number;
  importable: number;
}

export interface PreviewPackListRow {
  dealerKey: string;
  displayName: string;
  runId: string | null;
  importable: number | null;
  listingCount: number;
  enabled: boolean;
  materialized: boolean;
  slug: string | null;
}

export async function listAvailablePreviewArchives(root?: string) {
  const latestRunId = readLatestArchiveRunId(root);
  const newestByDealer = new Map<string, string>();
  for (const runId of listArchiveRunIds(root)) {
    for (const dealerKey of listArchivedDealerKeys(runId, root)) {
      if (isExcludedPreviewDealerKey(dealerKey, registryGroupKey(dealerKey))) continue;
      if (!newestByDealer.has(dealerKey)) newestByDealer.set(dealerKey, runId);
    }
  }

  const dealers: PreviewArchiveDealer[] = [];
  for (const [dealerKey, runId] of newestByDealer) {
    const manifest = readManifest(dealerKey, runId, root);
    let displayName = manifest.displayName?.trim() || dealerKey;
    try {
      displayName = getDealer(dealerKey).displayName;
    } catch {
      // Keep archive display name when the registry entry is missing.
    }
    dealers.push({
      dealerKey,
      displayName,
      runId,
      uniqueVehicles: manifest.uniqueVehicles ?? 0,
      importable: manifest.importable ?? 0,
    });
  }
  dealers.sort((a, b) => a.displayName.localeCompare(b.displayName, "en-GB"));

  return {
    runId: latestRunId,
    archiveAvailable: newestByDealer.size > 0,
    dealers,
  };
}

export function mergePreviewPackRows(input: {
  archives: PreviewArchiveDealer[];
  packs: Array<{
    dealerKey: string;
    displayName: string;
    enabled: boolean;
    sourceRunId: string;
    listingCount: number;
    slug: string | null;
  }>;
}): PreviewPackListRow[] {
  const packByKey = new Map(input.packs.map((pack) => [pack.dealerKey, pack]));
  const rows = new Map<string, PreviewPackListRow>();

  for (const dealer of input.archives) {
    if (isExcludedPreviewDealerKey(dealer.dealerKey, registryGroupKey(dealer.dealerKey))) {
      continue;
    }
    const pack = packByKey.get(dealer.dealerKey);
    rows.set(dealer.dealerKey, {
      dealerKey: dealer.dealerKey,
      displayName: dealer.displayName,
      runId: dealer.runId,
      importable: dealer.importable,
      listingCount: pack?.listingCount ?? 0,
      enabled: pack?.enabled ?? false,
      materialized: Boolean(pack && pack.listingCount > 0),
      slug: pack?.slug ?? null,
    });
  }

  for (const pack of input.packs) {
    if (rows.has(pack.dealerKey)) continue;
    if (isExcludedPreviewDealerKey(pack.dealerKey, registryGroupKey(pack.dealerKey))) {
      continue;
    }
    rows.set(pack.dealerKey, {
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      runId: pack.sourceRunId,
      importable: null,
      listingCount: pack.listingCount,
      enabled: pack.enabled,
      materialized: pack.listingCount > 0,
      slug: pack.slug,
    });
  }

  return [...rows.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "en-GB"),
  );
}

export function dealerSnapshotPath(dealerKey: string, runId: string, root?: string) {
  return dealerDir(archiveRoot(root), runId, dealerKey);
}
