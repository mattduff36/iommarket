import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { archiveRoot, runDir } from "../../scripts/dealer-stock-sync/archive/paths";
import { registryGroupKey } from "./archive";
import { isExcludedPreviewDealerKey } from "./safety";

export function listOceanArchiveDealerDirs(root?: string) {
  const archive = archiveRoot(root);
  const runsDir = join(archive, "runs");
  if (!existsSync(runsDir)) return [];
  const removed: string[] = [];
  for (const run of readdirSync(runsDir, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const dir = runDir(archive, run.name);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!isExcludedPreviewDealerKey(entry.name, registryGroupKey(entry.name))) {
        continue;
      }
      removed.push(join(dir, entry.name));
    }
  }
  return removed;
}

export function deleteOceanArchiveDealerDirs(root?: string) {
  const dirs = listOceanArchiveDealerDirs(root);
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}
