import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isArchivedPreviewDealerKey } from "../../lib/preview-packs/safety";
import type { ArchivedVehicle, ImageArchiveRecord } from "../dealer-stock-sync/types";
import { PACK_UNVERIFIED_IDENTITY } from "./review-types";

export function isPackUnverifiedIdentity(identityKey: string) {
  return identityKey.trim() === PACK_UNVERIFIED_IDENTITY;
}

export function reviewIdentityKeys(identityKey: string) {
  const trimmed = identityKey.trim();
  const keys = new Set<string>([trimmed]);
  if (trimmed.startsWith("stockId:")) {
    keys.add(`sourceVehicleId:${trimmed.slice("stockId:".length)}`);
  }
  if (trimmed.startsWith("sourceVehicleId:")) {
    keys.add(`stockId:${trimmed.slice("sourceVehicleId:".length)}`);
  }
  return keys;
}

export function snapshotIdentityKeys(vehicle: ArchivedVehicle) {
  const keys = reviewIdentityKeys(vehicle.identityKey);
  const sourceVehicleId = vehicle.vehicle.sourceVehicleId?.trim();
  if (sourceVehicleId) {
    keys.add(`sourceVehicleId:${sourceVehicleId}`);
    keys.add(`stockId:${sourceVehicleId}`);
  }
  return keys;
}

export function identitiesOverlap(
  left: Iterable<string>,
  right: Iterable<string>,
) {
  const wanted = left instanceof Set ? left : new Set(left);
  for (const key of right) {
    if (wanted.has(key)) return true;
  }
  return false;
}

export function archiveIdentityDirName(identityKey: string) {
  return identityKey.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function loadArchivedImagesFromDisk(
  dealerSnapshotDir: string,
  identityKeys: Iterable<string>,
): ImageArchiveRecord[] {
  const imagesRoot = join(dealerSnapshotDir, "images");
  if (!existsSync(imagesRoot)) return [];
  const records: ImageArchiveRecord[] = [];
  const seen = new Set<string>();
  for (const identityKey of identityKeys) {
    const dir = join(imagesRoot, archiveIdentityDirName(identityKey));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).sort()) {
      const localPath = join(dir, file);
      if (!statSync(localPath).isFile() || seen.has(localPath)) continue;
      seen.add(localPath);
      const bytes = readFileSync(localPath);
      records.push({
        originalUrl: `https://archive.invalid/${encodeURIComponent(file)}`,
        localPath,
        contentType: null,
        bytes: bytes.length,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        status: "ok",
        error: null,
      });
    }
  }
  return records;
}

export function usedReviewIdentities(
  dealerKey: string,
  identityKey: string,
  vehicles: ArchivedVehicle[] = [],
) {
  const keys = new Set<string>();
  if (isArchivedPreviewDealerKey(dealerKey) || isPackUnverifiedIdentity(identityKey)) {
    return keys;
  }
  for (const key of reviewIdentityKeys(identityKey)) {
    keys.add(`${dealerKey}|${key}`);
  }
  const match = vehicles.find((vehicle) =>
    identitiesOverlap(reviewIdentityKeys(identityKey), snapshotIdentityKeys(vehicle)));
  if (match) {
    for (const key of snapshotIdentityKeys(match)) {
      keys.add(`${dealerKey}|${key}`);
    }
  }
  return keys;
}

export function findSnapshotVehicle(
  vehicles: ArchivedVehicle[],
  identityKey: string,
) {
  const wanted = reviewIdentityKeys(identityKey);
  return vehicles.find((vehicle) =>
    identitiesOverlap(wanted, snapshotIdentityKeys(vehicle))) ?? null;
}
