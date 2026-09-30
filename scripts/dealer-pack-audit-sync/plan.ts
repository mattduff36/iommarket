import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { dealerSnapshotPath } from "../../lib/preview-packs/archive";
import {
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
  OCEAN_DEALER_KEY,
} from "../../lib/preview-packs/safety";
import type { ArchivedVehicle } from "../dealer-stock-sync/types";
import { PACK_BASELINE_SELECT, capturePackBaseline } from "./baseline";
import {
  classifySnapshot,
  excludedListingEvidence,
  hasValidSourceImages,
  type AuditSnapshotManifest,
  type SnapshotClassification,
} from "./classify";
import { sealPlan } from "./plan-file";
import { loadProductionSource } from "./production-source";
import { PRODUCTION_ACCOUNTS } from "./production-types";
import {
  DEALER_PACK_AUDIT_VERSION,
  type ExcludedListingEvidence,
  type PackAuditAction,
  type PreviewPackAuditPlan,
} from "./types";

async function readSnapshot(dealerKey: string, runId: string) {
  const dir = dealerSnapshotPath(dealerKey, runId);
  const [manifest, vehicles] = await Promise.all([
    readFile(join(dir, "manifest.json"), "utf8").then(
      (contents) => JSON.parse(contents) as AuditSnapshotManifest,
    ),
    readFile(join(dir, "vehicles.json"), "utf8").then(
      (contents) => JSON.parse(contents) as ArchivedVehicle[],
    ),
  ]);
  return { runId, manifest, vehicles };
}

function previewListingsFromClassification(classified: SnapshotClassification) {
  const leftover = classified.listings
    .filter((listing) => !hasValidSourceImages(listing.images))
    .map((listing) => excludedListingEvidence({
      identityKey: listing.identityKey,
      sourceUrl: listing.sourceUrl,
      title: listing.listing.title,
      findings: listing.findings,
    }));
  const seen = new Set<string>();
  const excludedListings = [...(classified.excludedListings ?? []), ...leftover]
    .filter((listing) => {
      if (seen.has(listing.identityKey)) return false;
      seen.add(listing.identityKey);
      return true;
    });
  return {
    listings: classified.listings.filter((listing) =>
      hasValidSourceImages(listing.images)),
    excludedListings,
  };
}

export function isSyntheticPackOwner(input: {
  isAdminPreview: boolean;
  email: string;
  authUserId: string;
}) {
  return (
    input.isAdminPreview &&
    isPreviewSystemEmail(input.email) &&
    isPreviewSystemAuthUserId(input.authUserId)
  );
}

export async function buildPreviewPackAuditPlan(input: {
  prisma: PrismaClient;
  runId: string;
  projectRef: string;
  confirmDb: string;
  sourceRunId: string;
  backupId: string;
  dealerKey?: string;
}): Promise<PreviewPackAuditPlan> {
  const backupId = input.backupId.trim();
  if (!backupId) throw new Error("preview-backup-id-required");
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
  const packs = await input.prisma.dealerPreviewPack.findMany({
    where: input.dealerKey ? { dealerKey: input.dealerKey } : undefined,
    orderBy: { dealerKey: "asc" },
    select: {
      ...PACK_BASELINE_SELECT,
      dealerKey: true,
      displayName: true,
      dealerProfile: {
        select: {
          isAdminPreview: true,
          user: { select: { email: true, authUserId: true } },
        },
      },
    },
  });
  if (input.dealerKey && packs.length !== 1) {
    throw new Error(`preview-pack-not-found:${input.dealerKey}`);
  }

  const actions: PackAuditAction[] = [];
  for (const pack of packs) {
    const baseline = capturePackBaseline(pack);
    const synthetic = isSyntheticPackOwner({
      isAdminPreview: pack.dealerProfile.isAdminPreview,
      email: pack.dealerProfile.user.email,
      authUserId: pack.dealerProfile.user.authUserId,
    });
    const snapshot = await readSnapshot(pack.dealerKey, input.sourceRunId).catch(() => null);
    const reasons: string[] = [];
    const hasOpenRevision = baseline.listings.some((listing) =>
      listing.revisions.some((revision) =>
        revision.status === "DRAFT" || revision.status === "PENDING"),
    );
    if (hasOpenRevision) reasons.push("open-listing-revision");
    if (!synthetic) reasons.push("non-synthetic-owner");
    if (!snapshot) reasons.push("source-snapshot-missing");
    if (snapshot && snapshot.manifest.dealerKey !== pack.dealerKey) {
      reasons.push("source-dealer-key-mismatch");
    }

    let classified: SnapshotClassification | null = null;
    if (pack.dealerKey === OCEAN_DEALER_KEY && synthetic && !hasOpenRevision) {
      const oceanAccount = PRODUCTION_ACCOUNTS.find(
        (account) => account.dealerKey === OCEAN_DEALER_KEY,
      );
      if (!oceanAccount) throw new Error("Ocean production account configuration is missing.");
      try {
        const source = await loadProductionSource(oceanAccount, input.runId);
        actions.push({
          kind: "replace",
          dealerKey: pack.dealerKey,
          displayName: pack.displayName,
          sourceRunId: source.runId,
          baseline,
          listings: source.listings.filter((listing) => hasValidSourceImages(listing.images)).map((listing) => ({
            identityKey: listing.identityKey,
            sourceUrl: listing.sourceUrl,
            listing: listing.listing,
            images: listing.images.map((image) => ({
              sourceUrl: image.sourceUrl,
              localPath: image.localPath,
              checksum: image.checksum,
              width: image.width,
              height: image.height,
              format: image.format,
              bytes: image.bytes,
              order: image.order,
            })),
            findings: listing.findings,
          })),
          excludedListings: source.excludedListings.map((listing) => ({
            identityKey: listing.identityKey,
            sourceUrl: listing.sourceUrl,
            title: listing.title,
            reasons: listing.reasons,
            findings: listing.findings,
          } satisfies ExcludedListingEvidence)),
        });
        continue;
      } catch (error) {
        reasons.push(
          `ocean-dedicated-source-failed:${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (snapshot) {
      try {
        classified = classifySnapshot({
          manifest: snapshot.manifest,
          vehicles: snapshot.vehicles,
        });
      } catch {
        reasons.push("source-classification-failed");
      }
    }
    if (classified && !classified.safe) reasons.push(...classified.reasons);

    if (
      snapshot &&
      classified?.safe &&
      synthetic &&
      !hasOpenRevision &&
      pack.dealerKey !== OCEAN_DEALER_KEY
    ) {
      const planned = previewListingsFromClassification(classified);
      actions.push({
        kind: "replace",
        dealerKey: pack.dealerKey,
        displayName: snapshot.manifest.displayName || pack.displayName,
        sourceRunId: snapshot.runId,
        baseline,
        listings: planned.listings,
        excludedListings: planned.excludedListings,
      });
      continue;
    }

    actions.push({
      kind: "disable",
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      sourceRunId: snapshot?.runId ?? null,
      baseline,
      removeListings: synthetic && !hasOpenRevision,
      reasons: [...new Set(reasons)].sort(),
      excludedListings: classified
        ? previewListingsFromClassification(classified).excludedListings
        : [],
    });
  }

  return sealPlan({
    version: DEALER_PACK_AUDIT_VERSION,
    runId: input.runId,
    createdAt: new Date().toISOString(),
    target: {
      projectRef: input.projectRef,
      confirmDb: input.confirmDb,
    },
    backupId,
    sourceRunId: input.sourceRunId,
    adminUserId: admins[0]!.id,
    actionCount: actions.length,
    actions,
  });
}
