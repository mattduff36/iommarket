import { EXPECTED_PRO_CAP } from "./target";
import { mapReconciledVehicle, matchesExistingListing, selectWithinCap } from "./map-vehicle";
import { liveInsertBlockedReason, reconcileVehicles } from "./reconcile";
import { buildImportReport } from "./report";
import type {
  ExistingDealerListing,
  ImportReport,
  MappedListing,
  MappingOutcome,
  ReconciledVehicle,
  SourceListResult,
} from "./types";

export interface PipelineResult {
  report: ImportReport;
  sourceResults: SourceListResult[];
  reconciled: ReconciledVehicle[];
  outcomes: MappingOutcome[];
  selected: MappingOutcome[];
  leftovers: MappingOutcome[];
  canLiveInsert: boolean;
}

export function runImportPipeline(input: {
  sourceResults: SourceListResult[];
  existingListings: ExistingDealerListing[];
  remainingSlots: number;
  scrapeStartedAt: Date;
  scrapeFinishedAt: Date;
  detailMissing?: number;
  proCap?: number;
}): PipelineResult {
  const reconciled = reconcileVehicles(input.sourceResults);
  const outcomes = reconciled.map(mapReconciledVehicle);
  const eligible = outcomes.filter((outcome) => outcome.listing);
  const alreadyPresentOutcomes = eligible.filter((outcome) =>
    matchesExistingListing(input.existingListings, outcome.listing as MappedListing),
  );
  const insertable = eligible.filter(
    (outcome) => !matchesExistingListing(input.existingListings, outcome.listing as MappedListing),
  );
  const { selected, leftovers } = selectWithinCap(
    insertable,
    input.remainingSlots,
    (outcome) => ({
      year: outcome.listing!.identity.year,
      mileage: outcome.listing!.identity.mileage,
    }),
  );

  const report = buildImportReport({
    scrapeStartedAt: input.scrapeStartedAt,
    scrapeFinishedAt: input.scrapeFinishedAt,
    sourceResults: input.sourceResults,
    reconciled,
    outcomes,
    alreadyPresent: alreadyPresentOutcomes.length,
    wouldInsert: selected.length,
    proCapLeftovers: leftovers.length,
    detailMissing: input.detailMissing ?? 0,
  });

  return {
    report,
    sourceResults: input.sourceResults,
    reconciled,
    outcomes,
    selected,
    leftovers,
    canLiveInsert:
      !liveInsertBlockedReason(input.sourceResults) &&
      report.reconciliationErrors.length === 0 &&
      (input.proCap ?? EXPECTED_PRO_CAP) === EXPECTED_PRO_CAP,
  };
}
