import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { reconcileSourceSnapshot, sourceRecordFromInventory, type MappedOriginal } from "@/lib/media/reconcile-source";
import { loadMigrationIndex } from "@/lib/media/migration-index";

function readJsonl(path: string) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const baselinePath = process.env.CLOUDINARY_BACKUP_INVENTORY;
const pass2Path = process.env.CLOUDINARY_BACKUP_INVENTORY_PASS2;
const mapPath = process.env.IMAGEKIT_MIGRATION_MAP;
if (!baselinePath || !pass2Path || !mapPath) {
  throw new Error("Reconciliation paths are not configured.");
}
if (!existsSync(baselinePath)) {
  throw new Error("Baseline inventory is not available. The existing backup was not restarted.");
}

const pass2Available = existsSync(pass2Path);
const index = loadMigrationIndex(mapPath);
const baseline: MappedOriginal[] = [...index.byAssetId.values()].map((asset) => ({
  assetId: asset.assetId,
  sourcePublicId: asset.sourcePublicId,
  sourceVersion: asset.sourceVersion,
  destinationFileId: asset.destinationFileId,
  destinationPath: asset.destinationPath,
  sourceBytes: asset.sourceBytes,
  sourceSha256: asset.sourceSha256,
}));
const pass2 = pass2Available ? readJsonl(pass2Path).map((row) => sourceRecordFromInventory(row)) : [];
const delta = reconcileSourceSnapshot({ pass2Available, baseline, pass2 });
mkdirSync("tmp", { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  baselineInventoryPresent: true,
  pass2Present: pass2Available,
  baselineMappedOriginals: baseline.length,
  status: delta.status,
  added: delta.added.length,
  replaced: delta.replaced.length,
  missingFromPass: delta.missingFromPass.length,
  unchanged: delta.unchanged,
  deletionsProposed: delta.deletionsProposed,
  examples: {
    added: delta.added.slice(0, 20),
    replaced: delta.replaced.slice(0, 20).map((item) => ({
      assetId: item.previous.assetId,
      fromVersion: item.previous.sourceVersion,
      toVersion: item.current.version,
    })),
    missingFromPass: delta.missingFromPass.slice(0, 20).map((item) => ({
      assetId: item.assetId,
      publicId: item.sourcePublicId,
      destinationFileId: item.destinationFileId,
    })),
  },
};
appendFileSync("tmp/imagekit-source-reconciliation.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  added: report.added,
  replaced: report.replaced,
  missingFromPass: report.missingFromPass,
  deletionsProposed: report.deletionsProposed,
}, null, 2));
