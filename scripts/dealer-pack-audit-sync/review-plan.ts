import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  dealerSnapshotPath,
  listArchivedDealerKeys,
} from "../../lib/preview-packs/archive";
import { isArchivedPreviewDealerKey } from "../../lib/preview-packs/safety";
import { mapReconciledVehicle } from "../dealer-stock-sync/map-listing";
import type { ArchivedVehicle } from "../dealer-stock-sync/types";
import { PACK_BASELINE_SELECT, capturePackBaseline } from "./baseline";
import { inspectUsableArchivedImages } from "./classify";
import { assertPlanIntegrity, auditRunDir } from "./plan-file";
import {
  findSnapshotVehicle,
  isPackUnverifiedIdentity,
  loadArchivedImagesFromDisk,
  reviewIdentityKeys,
  snapshotIdentityKeys,
  usedReviewIdentities,
} from "./review-identity";
import {
  assertCanonicalReviewSourceRun,
  assertNoRexDealerKey,
  assertReviewCounts,
  assertReviewPlanIntegrity,
  sealReviewPlan,
} from "./review-safety";
import {
  CANONICAL_AUDIT_PLAN_RELATIVE,
  CANONICAL_REVIEW_LISTING_COUNT,
  CANONICAL_REVIEW_SOURCE_RUN_ID,
  CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
  DEALER_PACK_REVIEW_VERSION,
  type PlannedReviewListing,
  type PreviewReviewPlan,
  type ReviewPackAction,
} from "./review-types";
import { isSyntheticPackOwner } from "./plan";
import type { PreviewPackAuditPlan } from "./types";

export interface ReviewVehicleLoader {
  loadVehicles: (dealerKey: string) => ArchivedVehicle[];
  snapshotDir?: (dealerKey: string) => string;
}

export function reviewPlanPath(runId: string, cwd = process.cwd()) {
  return resolve(auditRunDir(runId, cwd), "preview-review-plan.json");
}

export async function writeFrozenReviewPlan(path: string, plan: PreviewReviewPlan) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function readFrozenReviewPlan(path: string) {
  const plan = JSON.parse(await readFile(path, "utf8")) as PreviewReviewPlan;
  assertReviewPlanIntegrity(plan);
  return plan;
}

export function readCanonicalAuditPlan(path = CANONICAL_AUDIT_PLAN_RELATIVE) {
  const plan = JSON.parse(readFileSync(path, "utf8")) as PreviewPackAuditPlan;
  assertPlanIntegrity(plan);
  return plan;
}

export function createArchiveVehicleLoader(
  sourceRunId: string,
  archiveRoot?: string,
): ReviewVehicleLoader {
  return {
    loadVehicles(dealerKey) {
      assertNoRexDealerKey(dealerKey);
      const dir = dealerSnapshotPath(dealerKey, sourceRunId, archiveRoot);
      const vehiclesPath = join(dir, "vehicles.json");
      if (!existsSync(vehiclesPath)) return [];
      const raw = JSON.parse(readFileSync(vehiclesPath, "utf8")) as
        | ArchivedVehicle[]
        | { vehicles?: ArchivedVehicle[] };
      return Array.isArray(raw) ? raw : (raw.vehicles ?? []);
    },
    snapshotDir(dealerKey) {
      return dealerSnapshotPath(dealerKey, sourceRunId, archiveRoot);
    },
  };
}

function usedIdentitySet(
  auditPlan: PreviewPackAuditPlan,
  loader: ReviewVehicleLoader,
) {
  const used = new Set<string>();
  for (const action of auditPlan.actions) {
    const vehicles = isArchivedPreviewDealerKey(action.dealerKey)
      ? []
      : loader.loadVehicles(action.dealerKey);
    if (action.kind === "replace") {
      for (const listing of action.listings) {
        for (const key of usedReviewIdentities(action.dealerKey, listing.identityKey, vehicles)) {
          used.add(key);
        }
      }
    }
    for (const listing of action.excludedListings ?? []) {
      for (const key of usedReviewIdentities(action.dealerKey, listing.identityKey, vehicles)) {
        used.add(key);
      }
    }
  }
  return used;
}

export function collectUnclassifiedImportable(
  auditPlan: PreviewPackAuditPlan,
  loader: ReviewVehicleLoader,
  dealerKeys: string[],
) {
  const used = usedIdentitySet(auditPlan, loader);
  const leftovers: Array<{ dealerKey: string; identityKey: string }> = [];
  for (const dealerKey of dealerKeys) {
    if (isArchivedPreviewDealerKey(dealerKey)) continue;
    for (const vehicle of loader.loadVehicles(dealerKey)) {
      if (!vehicle.importable) continue;
      const keys = [...snapshotIdentityKeys(vehicle)].map((key) => `${dealerKey}|${key}`);
      if (keys.some((key) => used.has(key))) continue;
      leftovers.push({ dealerKey, identityKey: vehicle.identityKey });
    }
  }
  return leftovers;
}

function inspectReviewImages(
  vehicle: ArchivedVehicle,
  dealerKey: string,
  identityKey: string,
  loader: ReviewVehicleLoader,
) {
  const recorded = inspectUsableArchivedImages(vehicle.images);
  const dir = loader.snapshotDir?.(dealerKey);
  if (!dir) return recorded;
  const disk = loadArchivedImagesFromDisk(dir, [
    ...reviewIdentityKeys(identityKey),
    ...snapshotIdentityKeys(vehicle),
  ]);
  const extra = inspectUsableArchivedImages(disk, { requireUsableUrl: false });
  const seen = new Set(recorded.images.map((image) => image.checksum));
  const merged = [
    ...recorded.images,
    ...extra.images.filter((image) => !seen.has(image.checksum)),
  ].map((image, order) => ({ ...image, order }));
  return {
    images: merged,
    findings: [...recorded.findings, ...extra.findings],
  };
}

export function removeSharedReviewImages(
  listings: Array<PlannedReviewListing & { dealerKey: string }>,
) {
  const checksumOwners = new Map<string, Set<string>>();
  for (const listing of listings) {
    const owner = `${listing.dealerKey}|${listing.identityKey}`;
    for (const image of listing.images) {
      const owners = checksumOwners.get(image.checksum) ?? new Set<string>();
      owners.add(owner);
      checksumOwners.set(image.checksum, owners);
    }
  }
  for (const listing of listings) {
    const shared = new Set(
      listing.images
        .filter((image) => (checksumOwners.get(image.checksum)?.size ?? 0) > 1)
        .map((image) => image.checksum),
    );
    if (shared.size === 0) continue;
    listing.images = listing.images
      .filter((image) => !shared.has(image.checksum))
      .map((image, order) => ({ ...image, order }));
    listing.findings = [
      ...new Set([
        ...listing.findings,
        ...[...shared].map((checksum) => `image-rejected:shared-checksum:${checksum}`),
      ]),
    ].sort();
  }
}

export function reconstructReviewListings(input: {
  auditPlan: PreviewPackAuditPlan;
  loader: ReviewVehicleLoader;
  expectedListingCount?: number;
  expectedUnclassifiedCount?: number;
  dealerKeys?: string[];
}) {
  const listings: Array<PlannedReviewListing & { dealerKey: string }> = [];
  const leftovers = collectUnclassifiedImportable(
    input.auditPlan,
    input.loader,
    input.dealerKeys ?? input.auditPlan.actions.map((action) => action.dealerKey),
  );
  const leftoverKeys = new Set(
    leftovers.map((item) => `${item.dealerKey}|${item.identityKey}`),
  );

  for (const action of input.auditPlan.actions) {
    if (isArchivedPreviewDealerKey(action.dealerKey)) continue;
    const vehicles = input.loader.loadVehicles(action.dealerKey);
    for (const excluded of action.excludedListings ?? []) {
      if (isPackUnverifiedIdentity(excluded.identityKey)) continue;
      const vehicle = findSnapshotVehicle(vehicles, excluded.identityKey);
      if (!vehicle) {
        throw new Error(
          `Refusing review sync: missing snapshot for ${action.dealerKey}:${excluded.identityKey}.`,
        );
      }
      if (leftoverKeys.has(`${action.dealerKey}|${vehicle.identityKey}`)) {
        throw new Error(
          `Refusing review sync: unclassified leftover ${action.dealerKey}:${vehicle.identityKey}.`,
        );
      }
      const mapped = mapReconciledVehicle(vehicle);
      if (!mapped.listing) {
        throw new Error(
          `Refusing review sync: snapshot is not reconstructable (${action.dealerKey}:${excluded.identityKey}:${mapped.skipReason ?? "unknown"}).`,
        );
      }
      const inspected = inspectReviewImages(
        vehicle,
        action.dealerKey,
        excluded.identityKey,
        input.loader,
      );
      listings.push({
        dealerKey: action.dealerKey,
        identityKey: excluded.identityKey,
        snapshotIdentityKey: vehicle.identityKey,
        sourceUrl: excluded.sourceUrl ?? vehicle.vehicle.detailUrl,
        title: excluded.title ?? mapped.listing.title,
        reasons: [...excluded.reasons].sort(),
        findings: [...new Set([...excluded.findings, ...inspected.findings])].sort(),
        listing: mapped.listing,
        images: inspected.images,
      });
    }
  }

  removeSharedReviewImages(listings);

  assertReviewCounts({
    listingCount: listings.length,
    unclassifiedImportableCount: leftovers.length,
    expectedListingCount: input.expectedListingCount,
    expectedUnclassifiedCount: input.expectedUnclassifiedCount,
  });
  return { listings, unclassified: leftovers };
}

function packReviewReasons(
  action: PreviewPackAuditPlan["actions"][number],
  listings: PlannedReviewListing[],
) {
  const reasons = new Set<string>();
  if (action.kind === "disable") {
    for (const reason of action.reasons) reasons.add(reason);
  }
  for (const excluded of action.excludedListings ?? []) {
    for (const reason of excluded.reasons) reasons.add(reason);
  }
  for (const listing of listings) {
    for (const reason of listing.reasons) reasons.add(reason);
  }
  return [...reasons].sort();
}

export function buildReviewActionsFromAudit(input: {
  auditPlan: PreviewPackAuditPlan;
  reconstructed: Array<PlannedReviewListing & { dealerKey: string }>;
  packs: Map<string, ReviewPackAction["baseline"] & {
    displayName: string;
    packSourceRunId: string;
    keepEnabled: boolean;
  }>;
}): ReviewPackAction[] {
  const listingsByDealer = new Map<string, PlannedReviewListing[]>();
  for (const listing of input.reconstructed) {
    const current = listingsByDealer.get(listing.dealerKey) ?? [];
    current.push(listing);
    listingsByDealer.set(listing.dealerKey, current);
  }
  const actions: ReviewPackAction[] = [];
  for (const action of input.auditPlan.actions) {
    if (isArchivedPreviewDealerKey(action.dealerKey)) continue;
    const listings = listingsByDealer.get(action.dealerKey) ?? [];
    const hasPlaceholder = (action.excludedListings ?? []).some((listing) =>
      isPackUnverifiedIdentity(listing.identityKey));
    if (listings.length === 0 && !hasPlaceholder) continue;
    const pack = input.packs.get(action.dealerKey);
    if (!pack) {
      throw new Error(`Refusing review sync: preview pack missing for ${action.dealerKey}.`);
    }
    actions.push({
      dealerKey: action.dealerKey,
      displayName: action.displayName,
      keepEnabled: pack.keepEnabled,
      packSourceRunId: pack.packSourceRunId,
      reviewSourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
      reviewReasons: packReviewReasons(action, listings),
      baseline: pack,
      listings,
    });
  }
  return actions;
}

export async function buildPreviewReviewPlan(input: {
  prisma: PrismaClient;
  runId: string;
  projectRef: string;
  confirmDb: string;
  backupId: string;
  auditPlanPath?: string;
  sourceRunId?: string;
  loader?: ReviewVehicleLoader;
}): Promise<PreviewReviewPlan> {
  const backupId = input.backupId.trim();
  if (!backupId) throw new Error("preview-review-backup-id-required");
  const sourceRunId = input.sourceRunId ?? CANONICAL_REVIEW_SOURCE_RUN_ID;
  assertCanonicalReviewSourceRun(sourceRunId);
  const auditPlanPath = input.auditPlanPath ?? CANONICAL_AUDIT_PLAN_RELATIVE;
  const auditPlan = readCanonicalAuditPlan(auditPlanPath);
  const loader = input.loader ?? createArchiveVehicleLoader(sourceRunId);
  const reconstructed = reconstructReviewListings({
    auditPlan,
    loader,
    expectedListingCount: CANONICAL_REVIEW_LISTING_COUNT,
    expectedUnclassifiedCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
    dealerKeys: [
      ...new Set([
        ...auditPlan.actions.map((action) => action.dealerKey),
        ...listArchivedDealerKeys(sourceRunId),
      ]),
    ],
  });

  const admins = await input.prisma.user.findMany({
    where: {
      email: { equals: "admin@mpdee.co.uk", mode: "insensitive" },
      role: "ADMIN",
      deletedAt: null,
    },
    select: { id: true },
    take: 2,
  });
  if (admins.length !== 1) throw new Error("preview-admin-not-unique");

  const neededKeys = [...new Set(reconstructed.listings.map((listing) => listing.dealerKey))];
  for (const action of auditPlan.actions) {
    if (isArchivedPreviewDealerKey(action.dealerKey)) continue;
    if ((action.excludedListings ?? []).some((listing) =>
      isPackUnverifiedIdentity(listing.identityKey))) {
      neededKeys.push(action.dealerKey);
    }
  }
  const packs = await input.prisma.dealerPreviewPack.findMany({
    where: { dealerKey: { in: [...new Set(neededKeys)] } },
    select: {
      ...PACK_BASELINE_SELECT,
      dealerKey: true,
      displayName: true,
      listings: {
        ...PACK_BASELINE_SELECT.listings,
        where: { reviewSourceIdentity: null },
      },
      dealerProfile: {
        select: {
          isAdminPreview: true,
          user: { select: { email: true, authUserId: true } },
        },
      },
    },
  });
  const packMap = new Map<string, ReviewPackAction["baseline"] & {
    displayName: string;
    packSourceRunId: string;
    keepEnabled: boolean;
  }>();
  for (const pack of packs) {
    assertNoRexDealerKey(pack.dealerKey);
    if (!isSyntheticPackOwner({
      isAdminPreview: pack.dealerProfile.isAdminPreview,
      email: pack.dealerProfile.user.email,
      authUserId: pack.dealerProfile.user.authUserId,
    })) {
      throw new Error(`Refusing review sync: non-synthetic owner for ${pack.dealerKey}.`);
    }
    const baseline = capturePackBaseline(pack);
    packMap.set(pack.dealerKey, {
      ...baseline,
      displayName: pack.displayName,
      packSourceRunId: pack.sourceRunId,
      keepEnabled: baseline.enabled,
    });
  }

  const actions = buildReviewActionsFromAudit({
    auditPlan,
    reconstructed: reconstructed.listings,
    packs: packMap,
  });
  return sealReviewPlan({
    version: DEALER_PACK_REVIEW_VERSION,
    kind: "preview-review",
    runId: input.runId,
    createdAt: new Date().toISOString(),
    target: {
      projectRef: input.projectRef,
      confirmDb: input.confirmDb,
    },
    backupId,
    sourceRunId,
    auditPlanPath,
    auditPlanFingerprint: auditPlan.fingerprint,
    adminUserId: admins[0]!.id,
    actionCount: actions.length,
    listingCount: reconstructed.listings.length,
    unclassifiedImportableCount: reconstructed.unclassified.length,
    actions,
  });
}
