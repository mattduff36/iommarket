import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { dealerSnapshotPath } from "../../lib/preview-packs/archive";
import { OCEAN_DEALER_KEY } from "../../lib/preview-packs/safety";
import { isIgnoredImageUrl } from "../dealer-stock-sync/html-media";
import { isOceanEligibleLocation } from "../import-ocean-inventory/locations";
import type { ArchivedVehicle, SourceStatus } from "../dealer-stock-sync/types";
import type { MappedArchiveListing } from "../dealer-stock-sync/map-listing";
import {
  classifySnapshot,
  type AuditSnapshotManifest,
  type SnapshotClassification,
} from "./classify";
import { LIVE_ORDER_RECONCILED_FINDING } from "./finalize-live";
import { canonicalJson } from "./plan-file";
import type { ProductionAuditPlan, ProductionSourceListing } from "./production-types";
import type { PlannedListing, PreviewPackAuditPlan } from "./types";

export const SOURCE_COMPARE_VERSION = 1 as const;

const COMPLETE_SOURCE_STATUSES = new Set<SourceStatus>(["ok", "no_public_stock"]);

export type SourceCompareChange =
  | "unchanged"
  | "modified"
  | "new"
  | "missing"
  | "source_failed"
  | "explained_still_unsafe"
  | "explained_ineligible"
  | "explained_excluded"
  | "explained_live_order"
  | "explained_connector_representation";

export type SourceCompareTarget = "preview" | "production";

export interface SourceCompareListing {
  identityKey: string;
  plannedIdentityKey: string | null;
  archiveIdentityKey: string | null;
  targets: SourceCompareTarget[];
  change: SourceCompareChange;
  unexplained: boolean;
  explanation: string | null;
  listingChanges: string[];
  plannedChecksums: string[];
  archiveChecksums: string[];
  plannedFindings: string[];
  archiveFindings: string[];
}

export interface SourceCompareDealer {
  dealerKey: string;
  displayName: string;
  previewKind: "replace" | "disable" | null;
  productionPresent: boolean;
  archivePresent: boolean;
  sourceFailed: boolean;
  stillUnsafe: boolean;
  classifiedSafe: boolean | null;
  classifiedReasons: string[];
  plannedCount: number;
  archiveCount: number;
  ineligibleCount: number;
  unexplainedCount: number;
  listings: SourceCompareListing[];
}

export interface SourceCompareReport {
  version: typeof SOURCE_COMPARE_VERSION;
  kind: "source-compare";
  runId: string;
  createdAt: string;
  previewRunId: string;
  previewOverlayRunIds: string[];
  productionRunId: string;
  productionOverlayRunIds: string[];
  sourceRunId: string;
  sourceRunOverrides: Record<string, string>;
  previewFingerprint: string;
  previewOverlayFingerprints: string[];
  productionFingerprint: string;
  productionOverlayFingerprints: string[];
  ok: boolean;
  unexplainedCount: number;
  dealers: SourceCompareDealer[];
}

export interface CompareDealerSourceInput {
  dealerKey: string;
  displayName: string;
  preview: {
    kind: "replace" | "disable";
    reasons?: string[];
    listings: PlannedListing[];
    excludedListings?: Array<{
      identityKey: string;
      reasons: string[];
      findings: string[];
    }>;
  } | null;
  production: { listings: PlannedListing[] } | null;
  snapshot: { manifest: AuditSnapshotManifest; vehicles: ArchivedVehicle[] } | null;
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function normalizeSourceCompareIdentity(identityKey: string) {
  const match = /^(stockId|sourceVehicleId):(.+)$/i.exec(identityKey);
  if (!match) return identityKey;
  return `sourceVehicleId:${normalizeKeyPart(match[2]!)}`;
}

export function isFailedRequiredSource(manifest: AuditSnapshotManifest) {
  const required = (manifest.sources ?? []).filter((source) => source.required !== false);
  return (
    required.length === 0 ||
    required.some((source) => !COMPLETE_SOURCE_STATUSES.has(source.status))
  );
}

export function partitionOceanArchiveVehicles(vehicles: ArchivedVehicle[]) {
  const eligible: ArchivedVehicle[] = [];
  const ineligible: ArchivedVehicle[] = [];
  for (const vehicle of vehicles) {
    if (isOceanEligibleLocation(vehicle.vehicle.locationName)) eligible.push(vehicle);
    else ineligible.push(vehicle);
  }
  return { eligible, ineligible };
}

function coreListing(listing: MappedArchiveListing) {
  return {
    title: listing.title,
    description: listing.description,
    pricePence: listing.pricePence,
    categorySlug: listing.categorySlug,
    attributes: listing.attributes,
  };
}

function orderedChecksums(images: Array<{ checksum: string; order: number }>) {
  return [...images]
    .sort((left, right) => left.order - right.order)
    .map((image) => image.checksum);
}

function listingFieldChanges(
  planned: MappedArchiveListing | null,
  archive: MappedArchiveListing | null,
) {
  if (!planned || !archive) return [];
  const changes: string[] = [];
  const expected = coreListing(planned);
  const actual = coreListing(archive);
  for (const field of ["title", "description", "pricePence", "categorySlug"] as const) {
    if (expected[field] !== actual[field]) changes.push(field);
  }
  if (canonicalJson(expected.attributes) !== canonicalJson(actual.attributes)) {
    changes.push("attributes");
  }
  return changes;
}

function checksumsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function checksumPrefix(planned: string[], archive: string[]) {
  if (archive.length === 0) return planned.length === 0;
  return (
    archive.length <= planned.length &&
    archive.every((value, index) => value === planned[index])
  );
}

function oceanArchiveSubsetIsExplained(
  plannedImages: PlannedListing["images"],
  archive: string[],
  archiveFindings: string[],
) {
  const orderedPlannedImages = [...plannedImages].sort(
    (left, right) => left.order - right.order,
  );
  const planned = orderedPlannedImages.map((image) => image.checksum);
  if (!checksumPrefix(planned, archive)) return false;
  if (archive.length === planned.length) return true;
  return orderedPlannedImages
    .slice(archive.length)
    .every(
      (image, offset) =>
        !isIgnoredImageUrl(image.sourceUrl) &&
        archiveFindings.some(
          (finding) =>
            finding ===
            `image-rejected:${archive.length + offset}:ignored asset`,
        ),
    );
}

function findingsEqual(left: string[], right: string[]) {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function productionListingToPlanned(source: ProductionSourceListing): PlannedListing {
  const { regionSlug: _regionSlug, ...listing } = source.listing;
  return {
    identityKey: source.identityKey,
    sourceUrl: source.sourceUrl,
    listing,
    images: source.images.map((image) => ({
      sourceUrl: image.sourceUrl,
      localPath: image.localPath,
      checksum: image.checksum,
      width: image.width,
      height: image.height,
      format: image.format,
      bytes: image.bytes,
      order: image.order,
    })),
    findings: source.findings,
  };
}

function plannedFromPreview(plan: PreviewPackAuditPlan) {
  const byDealer = new Map<string, {
    dealerKey: string;
    displayName: string;
    preview: NonNullable<CompareDealerSourceInput["preview"]>;
  }>();
  for (const action of plan.actions) {
    const existing = byDealer.get(action.dealerKey);
    if (existing && existing.preview.kind !== action.kind) {
      throw new Error(
        `Preview plan mixes ${existing.preview.kind} and ${action.kind} actions for ${action.dealerKey}.`,
      );
    }
    const listings = new Map(
      (existing?.preview.listings ?? []).map((listing) => [
        normalizeSourceCompareIdentity(listing.identityKey),
        listing,
      ]),
    );
    if (action.kind === "replace") {
      for (const listing of action.listings) {
        listings.set(normalizeSourceCompareIdentity(listing.identityKey), listing);
      }
    }
    const exclusions = new Map(
      (existing?.preview.excludedListings ?? []).map((listing) => [
        normalizeSourceCompareIdentity(listing.identityKey),
        listing,
      ]),
    );
    for (const listing of action.excludedListings) {
      const key = normalizeSourceCompareIdentity(listing.identityKey);
      const previous = exclusions.get(key);
      exclusions.set(key, {
        identityKey: listing.identityKey,
        reasons: [...new Set([...(previous?.reasons ?? []), ...listing.reasons])],
        findings: [...new Set([...(previous?.findings ?? []), ...listing.findings])],
      });
    }
    byDealer.set(action.dealerKey, {
      dealerKey: action.dealerKey,
      displayName: action.displayName,
      preview: {
        kind: action.kind,
        reasons: [
          ...new Set([
            ...(existing?.preview.reasons ?? []),
            ...(action.kind === "disable" ? action.reasons : []),
          ]),
        ],
        listings: [...listings.values()],
        excludedListings: [...exclusions.values()],
      },
    });
  }
  return [...byDealer.values()];
}

function productionPlannedListings(
  account: ProductionAuditPlan["accounts"][number],
) {
  return account.actions.flatMap((action) =>
    action.kind === "take_down" ? [] : [productionListingToPlanned(action.source)],
  );
}

interface MergedPlanned {
  comparableId: string;
  plannedIdentityKey: string;
  targets: SourceCompareTarget[];
  preview: PlannedListing | null;
  production: PlannedListing | null;
}

function mergePlannedListings(
  previewListings: PlannedListing[],
  productionListings: PlannedListing[],
) {
  const merged = new Map<string, MergedPlanned>();
  for (const listing of previewListings) {
    const comparableId = normalizeSourceCompareIdentity(listing.identityKey);
    merged.set(comparableId, {
      comparableId,
      plannedIdentityKey: listing.identityKey,
      targets: ["preview"],
      preview: listing,
      production: null,
    });
  }
  for (const listing of productionListings) {
    const comparableId = normalizeSourceCompareIdentity(listing.identityKey);
    const existing = merged.get(comparableId);
    if (existing) {
      existing.targets = [...existing.targets, "production"];
      existing.production = listing;
      continue;
    }
    merged.set(comparableId, {
      comparableId,
      plannedIdentityKey: listing.identityKey,
      targets: ["production"],
      preview: null,
      production: listing,
    });
  }
  return merged;
}

function plannedChecksumsFor(entry: MergedPlanned) {
  const preview = entry.preview ? orderedChecksums(entry.preview.images) : null;
  const production = entry.production
    ? orderedChecksums(entry.production.images)
    : null;
  return preview ?? production ?? [];
}

function plannedFindingsFor(entry: MergedPlanned) {
  return entry.preview?.findings ?? entry.production?.findings ?? [];
}

function plannedListingFor(entry: MergedPlanned) {
  return entry.preview?.listing ?? entry.production?.listing ?? null;
}

function imageEvidenceChanged(entry: MergedPlanned, archiveChecksums: string[]) {
  const previewChanged = entry.preview
    ? !checksumsEqual(orderedChecksums(entry.preview.images), archiveChecksums)
    : false;
  const productionChanged = entry.production
    ? !checksumsEqual(
        orderedChecksums(entry.production.images),
        archiveChecksums.slice(0, FEATURED_LISTING_PHOTO_LIMIT),
      )
    : false;
  return previewChanged || productionChanged;
}

function listingRow(input: {
  comparableId: string;
  plannedIdentityKey: string | null;
  archiveIdentityKey: string | null;
  targets: SourceCompareTarget[];
  change: SourceCompareChange;
  unexplained: boolean;
  explanation: string | null;
  listingChanges: string[];
  plannedChecksums: string[];
  archiveChecksums: string[];
  plannedFindings: string[];
  archiveFindings: string[];
}): SourceCompareListing {
  return {
    identityKey: input.comparableId,
    plannedIdentityKey: input.plannedIdentityKey,
    archiveIdentityKey: input.archiveIdentityKey,
    targets: input.targets,
    change: input.change,
    unexplained: input.unexplained,
    explanation: input.explanation,
    listingChanges: input.listingChanges,
    plannedChecksums: input.plannedChecksums,
    archiveChecksums: input.archiveChecksums,
    plannedFindings: input.plannedFindings,
    archiveFindings: input.archiveFindings,
  };
}

export function compareClassifiedDealer(input: {
  dealerKey: string;
  displayName: string;
  preview: CompareDealerSourceInput["preview"];
  production: CompareDealerSourceInput["production"];
  archivePresent: boolean;
  manifest: AuditSnapshotManifest | null;
  classified: SnapshotClassification | null;
  ineligible: ArchivedVehicle[];
}): SourceCompareDealer {
  const previewListings = input.preview?.kind === "replace" ? input.preview.listings : [];
  const productionListings = input.production?.listings ?? [];
  const planned = mergePlannedListings(previewListings, productionListings);
  const archiveListings = new Map(
    (input.classified?.listings ?? []).map((listing) => [
      normalizeSourceCompareIdentity(listing.identityKey),
      listing,
    ]),
  );
  const ineligibleById = new Map(
    input.ineligible.map((vehicle) => [
      normalizeSourceCompareIdentity(vehicle.identityKey),
      vehicle,
    ]),
  );
  const excludedById = new Map(
    (input.preview?.excludedListings ?? []).map((listing) => [
      normalizeSourceCompareIdentity(listing.identityKey),
      listing,
    ]),
  );
  const sourceFailed = input.manifest ? isFailedRequiredSource(input.manifest) : false;
  const stillUnsafe =
    input.preview?.kind === "disable" &&
    !sourceFailed &&
    input.classified?.safe !== true;
  const identities = [...new Set([
    ...planned.keys(),
    ...archiveListings.keys(),
    ...ineligibleById.keys(),
  ])].sort();

  const listings: SourceCompareListing[] = identities.map((comparableId) => {
    const plannedEntry = planned.get(comparableId) ?? null;
    const archive = archiveListings.get(comparableId) ?? null;
    const ineligible = ineligibleById.get(comparableId) ?? null;
    const excluded = excludedById.get(comparableId) ?? null;
    const targets = plannedEntry?.targets ?? [];
    const plannedChecksums = plannedEntry ? plannedChecksumsFor(plannedEntry) : [];
    const archiveChecksums = archive ? orderedChecksums(archive.images) : [];
    const plannedFindings = plannedEntry ? plannedFindingsFor(plannedEntry) : [];
    const archiveFindings = archive?.findings ?? [];
    const base = {
      comparableId,
      plannedIdentityKey: plannedEntry?.plannedIdentityKey ?? null,
      archiveIdentityKey: archive?.identityKey ?? ineligible?.identityKey ?? null,
      targets,
      listingChanges: [] as string[],
      plannedChecksums,
      archiveChecksums,
      plannedFindings,
      archiveFindings,
    };

    if (sourceFailed) {
      if (!plannedEntry && ineligible) {
        return listingRow({
          ...base,
          change: "explained_ineligible",
          unexplained: false,
          explanation: "ocean-location-ineligible",
        });
      }
      return listingRow({
        ...base,
        change: "source_failed",
        unexplained: plannedEntry !== null,
        explanation: "required-source-incomplete",
      });
    }

    if (stillUnsafe) {
      if (!plannedEntry && ineligible) {
        return listingRow({
          ...base,
          change: "explained_ineligible",
          unexplained: false,
          explanation: "ocean-location-ineligible",
        });
      }
      return listingRow({
        ...base,
        change: "explained_still_unsafe",
        unexplained: false,
        explanation: (input.classified?.reasons ?? []).join(",") || "preview-disabled-still-unsafe",
      });
    }

    if (!plannedEntry && ineligible) {
      return listingRow({
        ...base,
        change: "explained_ineligible",
        unexplained: false,
        explanation: "ocean-location-ineligible",
      });
    }

    if (!plannedEntry && archive && excluded) {
      return listingRow({
        ...base,
        plannedFindings: [...excluded.reasons, ...excluded.findings],
        change: "explained_excluded",
        unexplained: false,
        explanation: excluded.reasons.join(",") || "excluded-by-final-audit",
      });
    }

    if (plannedEntry && archive) {
      const listingChanges = [
        ...listingFieldChanges(plannedListingFor(plannedEntry), archive.listing),
        ...(plannedEntry.preview &&
          plannedEntry.production &&
          canonicalJson(coreListing(plannedEntry.preview.listing)) !==
            canonicalJson(coreListing(plannedEntry.production.listing))
          ? ["preview-production-metadata-mismatch"]
          : []),
      ];
      const checksumsChanged = imageEvidenceChanged(plannedEntry, archiveChecksums);
      const oceanChecksumsAreVerifiedPrefix =
        input.dealerKey === OCEAN_DEALER_KEY &&
        [plannedEntry.preview, plannedEntry.production]
          .filter((listing): listing is PlannedListing => listing !== null)
          .every((listing) =>
            oceanArchiveSubsetIsExplained(
              listing.images,
              archiveChecksums,
              archiveFindings,
            ),
          );
      const effectiveChecksumsChanged =
        checksumsChanged && !oceanChecksumsAreVerifiedPrefix;
      const findingsChanged = !findingsEqual(plannedFindings, archiveFindings);
      const liveOrderReconciled =
        plannedFindings.includes(LIVE_ORDER_RECONCILED_FINDING) &&
        listingChanges.length === 0 &&
        checksumsEqual(
          [...plannedChecksums].sort(),
          [...archiveChecksums].sort(),
        );
      if (liveOrderReconciled) {
        return listingRow({
          ...base,
          listingChanges: ["image-order"],
          change: "explained_live_order",
          unexplained: false,
          explanation: LIVE_ORDER_RECONCILED_FINDING,
        });
      }
      if (!effectiveChecksumsChanged && listingChanges.length === 0 && !findingsChanged) {
        return listingRow({
          ...base,
          listingChanges,
          change: "unchanged",
          unexplained: false,
          explanation: null,
        });
      }
      if (
        input.dealerKey === OCEAN_DEALER_KEY &&
        !effectiveChecksumsChanged &&
        (listingChanges.length > 0 || checksumsChanged) &&
        listingChanges.every(
          (change) => change === "description" || change === "attributes",
        )
      ) {
        return listingRow({
          ...base,
          listingChanges,
          change: "explained_connector_representation",
          unexplained: false,
          explanation:
            "ocean-dedicated-and-catalogue-connectors-retained-identical-images",
        });
      }
      return listingRow({
        ...base,
        listingChanges: effectiveChecksumsChanged
          ? [...listingChanges, "image-checksums"]
          : listingChanges,
        change: "modified",
        unexplained: true,
        explanation: effectiveChecksumsChanged
          ? "image-checksums-changed"
          : "listing-or-findings-changed",
      });
    }

    if (plannedEntry) {
      return listingRow({
        ...base,
        change: "missing",
        unexplained: true,
        explanation: "planned-listing-missing-from-archive",
      });
    }

    return listingRow({
      ...base,
      change: "new",
      unexplained: true,
      explanation: "archive-listing-not-in-plan",
    });
  });

  return {
    dealerKey: input.dealerKey,
    displayName: input.displayName,
    previewKind: input.preview?.kind ?? null,
    productionPresent: input.production != null,
    archivePresent: input.archivePresent,
    sourceFailed,
    stillUnsafe,
    classifiedSafe: input.classified?.safe ?? null,
    classifiedReasons: input.classified?.reasons ?? [],
    plannedCount: planned.size,
    archiveCount: archiveListings.size,
    ineligibleCount: input.ineligible.length,
    unexplainedCount: listings.filter((listing) => listing.unexplained).length,
    listings,
  };
}

export function compareDealerSource(input: CompareDealerSourceInput): SourceCompareDealer {
  let classified: SnapshotClassification | null = null;
  let ineligible: ArchivedVehicle[] = [];
  let manifest = input.snapshot?.manifest ?? null;

  if (input.snapshot) {
    const vehicles = input.snapshot.vehicles;
    const partitioned = input.dealerKey === OCEAN_DEALER_KEY
      ? partitionOceanArchiveVehicles(vehicles)
      : { eligible: vehicles, ineligible: [] };
    ineligible = partitioned.ineligible;
    try {
      classified = classifySnapshot({
        manifest: input.snapshot.manifest,
        vehicles: partitioned.eligible,
      });
    } catch {
      classified = {
        safe: false,
        noPublicStock: false,
        reasons: ["source-classification-failed"],
        listings: [],
      };
    }
    manifest = input.snapshot.manifest;
  } else if (input.preview?.kind === "disable") {
    classified = {
      safe: false,
      noPublicStock: false,
      reasons: ["source-snapshot-missing"],
      listings: [],
    };
  }

  return compareClassifiedDealer({
    dealerKey: input.dealerKey,
    displayName: input.displayName,
    preview: input.preview,
    production: input.production,
    archivePresent: input.snapshot != null,
    manifest,
    classified,
    ineligible,
  });
}

async function readArchiveSnapshot(
  dealerKey: string,
  sourceRunId: string,
  archiveRoot?: string,
) {
  const dir = dealerSnapshotPath(dealerKey, sourceRunId, archiveRoot);
  try {
    const [manifest, vehicles] = await Promise.all([
      readFile(join(dir, "manifest.json"), "utf8").then(
        (contents) => JSON.parse(contents) as AuditSnapshotManifest,
      ),
      readFile(join(dir, "vehicles.json"), "utf8").then(
        (contents) => JSON.parse(contents) as ArchivedVehicle[],
      ),
    ]);
    return { manifest, vehicles };
  } catch {
    return null;
  }
}

export async function buildSourceCompareReport(input: {
  runId: string;
  previewPlan: PreviewPackAuditPlan;
  previewOverlayPlans?: PreviewPackAuditPlan[];
  productionPlan: ProductionAuditPlan;
  productionOverlayPlans?: ProductionAuditPlan[];
  sourceRunId: string;
  sourceRunOverrides?: Record<string, string>;
  createdAt?: string;
  archiveRoot?: string;
}): Promise<SourceCompareReport> {
  const previewByKey = new Map(
    plannedFromPreview(input.previewPlan).map((dealer) => [
      dealer.dealerKey,
      dealer,
    ]),
  );
  for (const overlay of input.previewOverlayPlans ?? []) {
    for (const dealer of plannedFromPreview(overlay)) {
      previewByKey.set(dealer.dealerKey, dealer);
    }
  }
  const previewDealers = [...previewByKey.values()];
  const productionByKey = new Map(
    input.productionPlan.accounts.map((account) => [account.dealerKey, account]),
  );
  for (const overlay of input.productionOverlayPlans ?? []) {
    for (const account of overlay.accounts) {
      productionByKey.set(account.dealerKey, account);
    }
  }
  const dealerKeys = new Set([
    ...previewDealers.map((dealer) => dealer.dealerKey),
    ...productionByKey.keys(),
  ]);
  const dealers: SourceCompareDealer[] = [];

  for (const dealerKey of [...dealerKeys].sort()) {
    const preview = previewByKey.get(dealerKey);
    const productionAccount = productionByKey.get(dealerKey);
    const snapshot = await readArchiveSnapshot(
      dealerKey,
      input.sourceRunOverrides?.[dealerKey] ?? input.sourceRunId,
      input.archiveRoot,
    );
    dealers.push(compareDealerSource({
      dealerKey,
      displayName:
        preview?.displayName ??
        productionAccount?.displayName ??
        dealerKey,
      preview: preview?.preview ?? null,
      production: productionAccount
        ? { listings: productionPlannedListings(productionAccount) }
        : null,
      snapshot,
    }));
  }

  const unexplainedCount = dealers.reduce(
    (count, dealer) => count + dealer.unexplainedCount,
    0,
  );
  return {
    version: SOURCE_COMPARE_VERSION,
    kind: "source-compare",
    runId: input.runId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    previewRunId: input.previewPlan.runId,
    previewOverlayRunIds: (input.previewOverlayPlans ?? []).map(
      (plan) => plan.runId,
    ),
    productionRunId: input.productionPlan.runId,
    productionOverlayRunIds: (input.productionOverlayPlans ?? []).map(
      (plan) => plan.runId,
    ),
    sourceRunId: input.sourceRunId,
    sourceRunOverrides: input.sourceRunOverrides ?? {},
    previewFingerprint: input.previewPlan.fingerprint,
    previewOverlayFingerprints: (input.previewOverlayPlans ?? []).map(
      (plan) => plan.fingerprint,
    ),
    productionFingerprint: input.productionPlan.fingerprint,
    productionOverlayFingerprints: (input.productionOverlayPlans ?? []).map(
      (plan) => plan.fingerprint,
    ),
    ok: unexplainedCount === 0,
    unexplainedCount,
    dealers,
  };
}

export function renderSourceCompareReport(report: SourceCompareReport) {
  const lines = [
    "# Dealer pack source compare",
    "",
    `- Run: ${report.runId}`,
    `- Created: ${report.createdAt}`,
    `- Preview plan: ${report.previewRunId}`,
    `- Preview overlays: ${report.previewOverlayRunIds.join(", ") || "none"}`,
    `- Production plan: ${report.productionRunId}`,
    `- Production overlays: ${
      report.productionOverlayRunIds.join(", ") || "none"
    }`,
    `- Archive: ${report.sourceRunId}`,
    `- Archive overrides: ${
      Object.entries(report.sourceRunOverrides)
        .map(([dealerKey, runId]) => `${dealerKey}=${runId}`)
        .join(", ") || "none"
    }`,
    `- Preview fingerprint: ${report.previewFingerprint}`,
    `- Preview overlay fingerprints: ${
      report.previewOverlayFingerprints.join(", ") || "none"
    }`,
    `- Production fingerprint: ${report.productionFingerprint}`,
    `- Production overlay fingerprints: ${
      report.productionOverlayFingerprints.join(", ") || "none"
    }`,
    `- Unexplained: ${report.unexplainedCount}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
  ];

  for (const dealer of report.dealers) {
    lines.push(`## ${dealer.displayName} (${dealer.dealerKey})`, "");
    lines.push(`- Preview: ${dealer.previewKind ?? "none"}`);
    lines.push(`- Production: ${dealer.productionPresent ? "yes" : "no"}`);
    lines.push(`- Archive: ${dealer.archivePresent ? "present" : "missing"}`);
    lines.push(`- Source failed: ${dealer.sourceFailed ? "yes" : "no"}`);
    lines.push(`- Still unsafe: ${dealer.stillUnsafe ? "yes" : "no"}`);
    lines.push(`- Classified safe: ${dealer.classifiedSafe ?? "n/a"}`);
    lines.push(`- Classified reasons: ${dealer.classifiedReasons.join("; ") || "none"}`);
    lines.push(`- Planned listings: ${dealer.plannedCount}`);
    lines.push(`- Archive listings: ${dealer.archiveCount}`);
    lines.push(`- Ineligible extras: ${dealer.ineligibleCount}`);
    lines.push(`- Unexplained: ${dealer.unexplainedCount}`);
    lines.push("");
    for (const listing of dealer.listings) {
      lines.push(`### ${listing.identityKey}`, "");
      lines.push(`- Planned identity: ${listing.plannedIdentityKey ?? "none"}`);
      lines.push(`- Archive identity: ${listing.archiveIdentityKey ?? "none"}`);
      lines.push(`- Targets: ${listing.targets.join(", ") || "archive"}`);
      lines.push(`- Change: ${listing.change}`);
      lines.push(`- Unexplained: ${listing.unexplained ? "yes" : "no"}`);
      lines.push(`- Explanation: ${listing.explanation ?? "none"}`);
      lines.push(`- Listing changes: ${listing.listingChanges.join(", ") || "none"}`);
      lines.push(`- Planned checksums: ${listing.plannedChecksums.join(", ") || "none"}`);
      lines.push(`- Archive checksums: ${listing.archiveChecksums.join(", ") || "none"}`);
      lines.push(`- Planned findings: ${listing.plannedFindings.join("; ") || "none"}`);
      lines.push(`- Archive findings: ${listing.archiveFindings.join("; ") || "none"}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
