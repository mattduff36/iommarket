import { existsSync } from "node:fs";
import { mapReconciledVehicle } from "../dealer-stock-sync/map-listing";
import type {
  ArchivedVehicle,
  SourceStatus,
} from "../dealer-stock-sync/types";
import { isUsablePreviewImageUrl } from "../../lib/preview-packs/upload";
import {
  frozenImageQualityError,
  inspectFrozenImageFile,
} from "./image-quality";
import type { PlannedListing } from "./types";

export interface AuditSnapshotManifest {
  dealerKey: string;
  displayName: string;
  canArchive: boolean;
  connectorKey?: string;
  scrapeStartedAt?: string;
  scrapeFinishedAt?: string;
  sources: Array<{ key: string; required?: boolean; status: SourceStatus }>;
}

export interface SnapshotClassification {
  safe: boolean;
  noPublicStock: boolean;
  reasons: string[];
  listings: PlannedListing[];
}

const COMPLETE_SOURCE_STATUSES = new Set<SourceStatus>(["ok", "no_public_stock"]);
const ALLOWED_OMISSIONS = new Set(["poa", "sold"]);

function usableImages(vehicle: ArchivedVehicle) {
  const seen = new Set<string>();
  const findings: string[] = [];
  const images = vehicle.images.flatMap((image, index) => {
    if (
      image.status !== "ok" ||
      !image.checksum ||
      seen.has(image.checksum) ||
      !image.localPath ||
      !existsSync(image.localPath) ||
      !isUsablePreviewImageUrl(image.originalUrl)
    ) {
      findings.push(
        `image-rejected:${index}:${image.error ?? "unusable-or-duplicate"}`,
      );
      return [];
    }
    const metadata = inspectFrozenImageFile(image.localPath);
    const qualityError = frozenImageQualityError(metadata);
    if (!metadata || qualityError) {
      findings.push(`image-rejected:${index}:${qualityError ?? "invalid-metadata"}`);
      return [];
    }
    seen.add(image.checksum);
    return [{
      sourceUrl: image.originalUrl,
      localPath: image.localPath,
      checksum: image.checksum,
      ...metadata,
      order: index,
    }];
  }).map((image, order) => ({ ...image, order }));
  return { images, findings };
}

function crossVehicleChecksumConflicts(vehicles: ArchivedVehicle[]) {
  const owners = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const vehicle of vehicles) {
    for (const image of vehicle.images) {
      if (image.status !== "ok" || !image.checksum) continue;
      const owner = owners.get(image.checksum);
      if (owner && owner !== vehicle.identityKey) conflicts.add(image.checksum);
      owners.set(image.checksum, owner ?? vehicle.identityKey);
    }
  }
  return [...conflicts].sort();
}

export function classifySnapshot(input: {
  manifest: AuditSnapshotManifest;
  vehicles: ArchivedVehicle[];
}): SnapshotClassification {
  const reasons: string[] = [];
  const requiredSources = (input.manifest.sources ?? []).filter(
    (source) => source.required !== false,
  );
  const statuses = requiredSources.map((source) => source.status);
  const noPublicStock =
    statuses.length > 0 &&
    statuses.every((status) => status === "no_public_stock");

  if (input.manifest.canArchive !== true) reasons.push("manifest-cannot-archive");
  const finishedAt = Date.parse(input.manifest.scrapeFinishedAt ?? "");
  if (
    !Number.isFinite(finishedAt) ||
    finishedAt > Date.now() + 5 * 60_000 ||
    Date.now() - finishedAt > 24 * 60 * 60_000
  ) {
    reasons.push("source-snapshot-not-fresh");
  }
  if (
    statuses.length === 0 ||
    statuses.some((status) => !COMPLETE_SOURCE_STATUSES.has(status))
  ) {
    reasons.push("source-status-incomplete");
  }

  const listings: PlannedListing[] = [];
  for (const vehicle of input.vehicles) {
    const mapped = mapReconciledVehicle(vehicle);
    if (!mapped.listing) {
      if (!ALLOWED_OMISSIONS.has(mapped.skipReason ?? "")) {
        reasons.push(`vehicle-not-importable:${vehicle.identityKey}:${mapped.skipReason ?? "unknown"}`);
      }
      continue;
    }
    if (!vehicle.importable) {
      reasons.push(`archive-importable-mismatch:${vehicle.identityKey}`);
      continue;
    }
    const inspected = usableImages(vehicle);
    if (inspected.images.length === 0) {
      inspected.findings.push("listing-has-no-valid-source-image");
    }
    listings.push({
      identityKey: vehicle.identityKey,
      sourceUrl: vehicle.vehicle.detailUrl,
      listing: mapped.listing,
      images: inspected.images,
      findings: inspected.findings,
    });
  }

  const conflicts = crossVehicleChecksumConflicts(input.vehicles);
  if (conflicts.length > 0) {
    reasons.push(`cross-vehicle-image-checksum:${conflicts.join(",")}`);
  }
  if (noPublicStock) reasons.push("no-public-stock");
  if (!noPublicStock && listings.length === 0) reasons.push("no-includable-listings");

  return {
    safe: reasons.length === 0,
    noPublicStock,
    reasons: [...new Set(reasons)].sort(),
    listings,
  };
}
