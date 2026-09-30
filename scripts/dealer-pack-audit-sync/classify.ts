import { existsSync } from "node:fs";
import { mapReconciledVehicle } from "../dealer-stock-sync/map-listing";
import type {
  ArchivedVehicle,
  ImageArchiveRecord,
  SourceStatus,
} from "../dealer-stock-sync/types";
import { isUsablePreviewImageUrl } from "../../lib/preview-packs/upload";
import {
  frozenImageQualityError,
  inspectFrozenImageFile,
} from "./image-quality";
import type { ExcludedListingEvidence, PlannedListing } from "./types";

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
  excludedListings?: ExcludedListingEvidence[];
}

export const NO_VALID_SOURCE_IMAGE_REASON = "listing-has-no-valid-source-image";

export function hasValidSourceImages(images: { length: number }) {
  return images.length > 0;
}

export function excludedListingEvidence(input: {
  identityKey: string;
  sourceUrl: string | null;
  title: string | null;
  findings: string[];
  reasons?: string[];
}): ExcludedListingEvidence {
  return {
    identityKey: input.identityKey,
    sourceUrl: input.sourceUrl,
    title: input.title,
    reasons: [...new Set(input.reasons ?? [NO_VALID_SOURCE_IMAGE_REASON])].sort(),
    findings: [...new Set(input.findings)].sort(),
  };
}

const COMPLETE_SOURCE_STATUSES = new Set<SourceStatus>(["ok", "no_public_stock"]);
const ALLOWED_OMISSIONS = new Set(["poa", "sold"]);

export function inspectUsableArchivedImages(
  records: ImageArchiveRecord[],
  options: { requireUsableUrl?: boolean } = {},
) {
  const requireUsableUrl = options.requireUsableUrl ?? true;
  const seen = new Set<string>();
  const findings: string[] = [];
  const images = records.flatMap((image, index) => {
    if (
      image.status !== "ok" ||
      !image.checksum ||
      seen.has(image.checksum) ||
      !image.localPath ||
      !existsSync(image.localPath) ||
      (requireUsableUrl && !isUsablePreviewImageUrl(image.originalUrl))
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

function usableImages(vehicle: ArchivedVehicle) {
  return inspectUsableArchivedImages(vehicle.images);
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
  const excludedListings: ExcludedListingEvidence[] = [];
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
    if (!hasValidSourceImages(inspected.images)) {
      inspected.findings.push(NO_VALID_SOURCE_IMAGE_REASON);
      excludedListings.push(excludedListingEvidence({
        identityKey: vehicle.identityKey,
        sourceUrl: vehicle.vehicle.detailUrl,
        title: mapped.listing.title,
        findings: inspected.findings,
      }));
      continue;
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
  if (!noPublicStock && listings.length === 0 && excludedListings.length === 0) {
    reasons.push("no-includable-listings");
  }

  return {
    safe: reasons.length === 0,
    noPublicStock,
    reasons: [...new Set(reasons)].sort(),
    listings,
    excludedListings,
  };
}
