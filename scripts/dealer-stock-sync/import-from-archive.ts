import { getDealerListingCap } from "../../lib/config/dealer-tiers";
import { readDealerSnapshot } from "./archive/read";
import { mapReconciledVehicle } from "./map-listing";
import { getDealer } from "./registry";

export class ArchiveImportSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveImportSafetyError";
  }
}

export function assertArchiveDealerMatch(input: {
  archiveDealerKey: string;
  archiveDisplayName: string;
  requestedDealerKey: string;
  expectedName: string;
}) {
  if (input.requestedDealerKey !== input.archiveDealerKey) {
    throw new ArchiveImportSafetyError(
      `Archive dealer ${input.archiveDealerKey} does not match requested dealer ${input.requestedDealerKey}`,
    );
  }
  if (input.expectedName.trim() !== input.archiveDisplayName.trim()) {
    throw new ArchiveImportSafetyError(
      `Expected dealer name "${input.expectedName}" does not match archive "${input.archiveDisplayName}"`,
    );
  }
  const registry = getDealer(input.requestedDealerKey);
  if (registry.displayName.trim() !== input.expectedName.trim()) {
    throw new ArchiveImportSafetyError(
      `Expected dealer name "${input.expectedName}" does not match registry "${registry.displayName}"`,
    );
  }
}

export function reportArchiveImport(input: {
  vehicles: import("./types").ArchivedVehicle[];
  remainingSlots: number;
}) {
  const outcomes = input.vehicles.map((vehicle) => mapReconciledVehicle(vehicle));
  const importable = outcomes.filter((item) => item.listing);
  const leftovers = Math.max(0, importable.length - input.remainingSlots);
  return {
    archiveRecords: input.vehicles.length,
    validImportable: importable.length,
    recordsRequiringCorrection: outcomes.filter((item) => !item.listing).length,
    possibleDuplicates: input.vehicles.filter((item) => item.identityConflict).length,
    existingAccountMatches: 0,
    wouldAdd: Math.max(0, importable.length - leftovers),
    wouldUpdate: 0,
    listingCapOverflow: leftovers,
    imagesAvailable: input.vehicles.reduce(
      (sum, item) => sum + item.images.filter((image) => image.status === "ok" || image.originalUrl).length,
      0,
    ),
    sourceIdentities: input.vehicles.map((item) => ({
      identityKey: item.identityKey,
      identityKind: item.identityKind,
      sources: item.sources,
    })),
    correctionReasons: outcomes
      .filter((item) => item.skipReason)
      .map((item) => ({
        identityKey: item.reconciled.identityKey,
        reason: item.skipReason,
      })),
  };
}

export async function dryRunArchiveImport(input: {
  dealerKey: string;
  expectedName: string;
  runId: string;
  root?: string;
  remainingSlots?: number;
  apply?: boolean;
}) {
  if (input.apply) {
    throw new ArchiveImportSafetyError("Apply is disabled for this archival task. Dry-run only.");
  }
  const snapshot = await readDealerSnapshot({
    dealerKey: input.dealerKey,
    runId: input.runId,
    root: input.root,
  });
  assertArchiveDealerMatch({
    archiveDealerKey: snapshot.manifest.dealerKey,
    archiveDisplayName: snapshot.manifest.displayName,
    requestedDealerKey: input.dealerKey,
    expectedName: input.expectedName,
  });
  return reportArchiveImport({
    vehicles: snapshot.vehicles,
    remainingSlots: input.remainingSlots ?? getDealerListingCap("PRO"),
  });
}
