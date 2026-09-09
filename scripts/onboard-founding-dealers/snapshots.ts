import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findLatestRunForDealer } from "../../lib/preview-packs/archive";
import { archiveRoot, dealerDir } from "../dealer-stock-sync/archive/paths";
import { readDealerSnapshot } from "../dealer-stock-sync/archive/read";
import { assertArchiveDealerMatch } from "../dealer-stock-sync/import-from-archive";
import type { ArchivedVehicle } from "../dealer-stock-sync/types";
import { FOUNDING_DEALERS } from "./allowlist";
import { foundingArchiveChecksum } from "./identity";

export interface FrozenDealerSnapshot {
  dealerKey: string;
  displayName: string;
  runId: string;
  dir: string;
  checksum: string;
  vehicles: ArchivedVehicle[];
}

export async function freezeFoundingSnapshots(root?: string): Promise<FrozenDealerSnapshot[]> {
  const archive = archiveRoot(root);
  const frozen: FrozenDealerSnapshot[] = [];
  for (const dealer of FOUNDING_DEALERS) {
    const runId = findLatestRunForDealer(dealer.key, archive);
    if (!runId) {
      throw new Error(
        `Refusing founding onboard: archive missing for ${dealer.key}. Re-archive that dealer first.`,
      );
    }
    const snapshot = await readDealerSnapshot({ dealerKey: dealer.key, runId, root: archive });
    assertArchiveDealerMatch({
      archiveDealerKey: snapshot.manifest.dealerKey,
      archiveDisplayName: snapshot.manifest.displayName,
      requestedDealerKey: dealer.key,
      expectedName: dealer.displayName,
    });
    const dir = dealerDir(archive, runId, dealer.key);
    const manifestBytes = await readFile(join(dir, "manifest.json"));
    const vehiclesBytes = await readFile(join(dir, "vehicles.json"));
    frozen.push({
      dealerKey: dealer.key,
      displayName: dealer.displayName,
      runId,
      dir,
      checksum: foundingArchiveChecksum([manifestBytes, vehiclesBytes]),
      vehicles: snapshot.vehicles,
    });
  }
  return frozen;
}

export async function assertSnapshotUnchanged(snapshot: FrozenDealerSnapshot) {
  const manifestBytes = await readFile(join(snapshot.dir, "manifest.json"));
  const vehiclesBytes = await readFile(join(snapshot.dir, "vehicles.json"));
  const checksum = foundingArchiveChecksum([manifestBytes, vehiclesBytes]);
  if (checksum !== snapshot.checksum) {
    throw new Error(`Refusing founding onboard: archive changed for ${snapshot.dealerKey}.`);
  }
}
