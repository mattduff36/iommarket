import { filterOceanEligible, liveInsertBlockedReason, omvLowerBoundWarning, overlapBreakdown } from "./reconcile";
import { getOceanSource } from "./sources";
import type {
  ImportReport,
  ImportReportSource,
  MappingOutcome,
  ReconciledVehicle,
  SourceListResult,
} from "./types";

export function buildSourceReport(result: SourceListResult): ImportReportSource {
  const { eligible, excluded } = filterOceanEligible(result.vehicles);
  const excludedReasons = new Map<string, { location: string; reason: string; count: number }>();
  for (const item of excluded) {
    const key = item.reason;
    const current = excludedReasons.get(key);
    if (current) current.count += 1;
    else {
      excludedReasons.set(key, {
        location: item.vehicle.locationName,
        reason: item.reason,
        count: 1,
      });
    }
  }

  return {
    key: result.sourceKey,
    name: getOceanSource(result.sourceKey).name,
    startUrl: result.startUrl,
    status: result.status,
    error: result.error,
    pagesFetched: result.pagesFetched,
    rawCount: result.status === "ok" ? result.rawCount ?? result.vehicles.length : null,
    oceanEligibleCount: result.status === "ok" ? eligible.length : 0,
    excludedCount: result.status === "ok" ? excluded.length : 0,
    excludedReasons: [...excludedReasons.values()],
  };
}

export function reconcileReportMath(report: ImportReport) {
  const errors: string[] = [];
  const successful = report.sources.filter((source) => source.status === "ok");
  const raw = successful.reduce((sum, source) => sum + (source.rawCount ?? 0), 0);
  const eligible = successful.reduce((sum, source) => sum + source.oceanEligibleCount, 0);
  const excluded = successful.reduce((sum, source) => sum + source.excludedCount, 0);

  if (raw !== eligible + excluded) {
    errors.push(`raw ${raw} != eligible ${eligible} + excluded ${excluded}`);
  }
  if (report.successfulRawCount !== raw) {
    errors.push(`successfulRawCount ${report.successfulRawCount} != ${raw}`);
  }
  if (report.successfulEligibleCount !== eligible) {
    errors.push(`successfulEligibleCount ${report.successfulEligibleCount} != ${eligible}`);
  }
  if (
    report.uniqueAfterDedupe !==
    report.omvOnly + report.dedicatedOnly + report.overlap + report.identityConflicts
  ) {
    errors.push(
      `unique ${report.uniqueAfterDedupe} != omvOnly ${report.omvOnly} + dedicatedOnly ${report.dedicatedOnly} + overlap ${report.overlap} + conflicts ${report.identityConflicts}`,
    );
  }
  if (
    report.mappingEligible +
      report.poaSkips +
      report.mappingFailures +
      report.identityConflicts !==
    report.uniqueAfterDedupe
  ) {
    errors.push("mapping buckets do not add up to uniqueAfterDedupe");
  }
  if (report.insertCandidates !== report.mappingEligible - report.alreadyPresent) {
    errors.push(
      `insertCandidates ${report.insertCandidates} != mappingEligible ${report.mappingEligible} - alreadyPresent ${report.alreadyPresent}`,
    );
  }
  if (report.wouldInsert + report.proCapLeftovers !== report.insertCandidates) {
    errors.push(
      `wouldInsert ${report.wouldInsert} + leftovers ${report.proCapLeftovers} != insertCandidates ${report.insertCandidates}`,
    );
  }
  return errors;
}

export function buildImportReport(input: {
  scrapeStartedAt: Date;
  scrapeFinishedAt: Date;
  sourceResults: SourceListResult[];
  reconciled: ReconciledVehicle[];
  outcomes: MappingOutcome[];
  alreadyPresent: number;
  wouldInsert: number;
  proCapLeftovers: number;
  detailMissing: number;
}): ImportReport {
  const sources = input.sourceResults.map(buildSourceReport);
  const successful = sources.filter((source) => source.status === "ok");
  const overlap = overlapBreakdown(input.reconciled);
  const identityConflicts = input.outcomes.filter((item) => item.skipReason === "identity-conflict").length;
  const poaSkips = input.outcomes.filter(
    (item) => item.skipReason === "poa" || item.skipReason === "missing-price",
  ).length;
  const mappingFailures = input.outcomes.filter((item) =>
    item.skipReason === "invalid-price" ||
    item.skipReason === "missing-required-attr" ||
    item.skipReason === "invalid-title",
  ).length;
  const mappingEligible = input.outcomes.filter((item) => item.listing).length;
  const uniqueAfterDedupe = input.reconciled.length;
  const insertCandidates = mappingEligible - input.alreadyPresent;

  const report: ImportReport = {
    scrapeStartedAt: input.scrapeStartedAt.toISOString(),
    scrapeFinishedAt: input.scrapeFinishedAt.toISOString(),
    sources,
    failedSources: sources
      .filter((source) => source.status === "failed")
      .map((source) => ({ key: source.key, error: source.error ?? "unknown error" })),
    successfulRawCount: successful.reduce((sum, source) => sum + (source.rawCount ?? 0), 0),
    successfulEligibleCount: successful.reduce((sum, source) => sum + source.oceanEligibleCount, 0),
    omvOnly: overlap.omvOnly,
    dedicatedOnly: overlap.dedicatedOnly,
    overlap: overlap.overlap,
    duplicateRelationships: overlap.duplicateRelationships,
    priceMismatches: input.reconciled.filter((item) => item.priceMismatch).length,
    identityConflicts,
    detailMissing: input.detailMissing,
    uniqueAfterDedupe,
    mappingEligible,
    poaSkips,
    mappingFailures,
    mappingFailureDetails: input.outcomes
      .filter(
        (item) =>
          item.skipReason === "invalid-price" ||
          item.skipReason === "missing-required-attr" ||
          item.skipReason === "invalid-title",
      )
      .map((item) => ({
        identityKey: item.reconciled.identityKey,
        reason: item.skipReason ?? "unknown",
        detail: item.skipDetail,
        title: [
          item.reconciled.vehicle.year,
          item.reconciled.vehicle.make,
          item.reconciled.vehicle.model,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    alreadyPresent: input.alreadyPresent,
    insertCandidates,
    wouldInsert: input.wouldInsert,
    proCapLeftovers: input.proCapLeftovers,
    lowerBoundWarning: omvLowerBoundWarning(input.sourceResults),
    liveInsertBlockedReason: liveInsertBlockedReason(input.sourceResults),
    reconciliationErrors: [],
  };
  report.reconciliationErrors = reconcileReportMath(report);
  return report;
}

export function formatImportReport(report: ImportReport) {
  const lines = [
    "Ocean inventory import report",
    `started=${report.scrapeStartedAt}`,
    `finished=${report.scrapeFinishedAt}`,
    "",
    "Sources",
  ];
  for (const source of report.sources) {
    lines.push(
      [
        `- ${source.name} [${source.key}] ${source.status}`,
        `  url=${source.startUrl}`,
        `  pages=${source.pagesFetched} raw=${source.rawCount == null ? "n/a" : source.rawCount} eligible=${source.oceanEligibleCount} excluded=${source.excludedCount}`,
        source.error ? `  error=${source.error}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    for (const excluded of source.excludedReasons) {
      lines.push(`  excluded ${excluded.count}x ${excluded.reason} (${excluded.location})`);
    }
  }
  lines.push(
    "",
    `successfulRaw=${report.successfulRawCount}`,
    `successfulEligible=${report.successfulEligibleCount}`,
    `omvOnly=${report.omvOnly} dedicatedOnly=${report.dedicatedOnly} overlap=${report.overlap}`,
    `uniqueAfterDedupe=${report.uniqueAfterDedupe}`,
    `priceMismatches=${report.priceMismatches} identityConflicts=${report.identityConflicts} detailMissing=${report.detailMissing}`,
    `mappingEligible=${report.mappingEligible} poaSkips=${report.poaSkips} mappingFailures=${report.mappingFailures}`,
    `alreadyPresent=${report.alreadyPresent} insertCandidates=${report.insertCandidates}`,
    `wouldInsert=${report.wouldInsert} proCapLeftovers=${report.proCapLeftovers}`,
  );
  if (report.mappingFailureDetails.length > 0) {
    lines.push("", "Mapping failures");
    for (const item of report.mappingFailureDetails) {
      lines.push(`- ${item.identityKey} ${item.title} reason=${item.reason} ${item.detail ?? ""}`);
    }
  }
  if (report.duplicateRelationships.length > 0) {
    lines.push("", "Overlaps");
    for (const item of report.duplicateRelationships) {
      lines.push(`- ${item.identityKey}: ${item.sources.join(", ")}`);
    }
  }
  if (report.failedSources.length > 0) {
    lines.push("", "Failed sources");
    for (const failed of report.failedSources) {
      lines.push(`- ${failed.key}: ${failed.error}`);
    }
  }
  if (report.lowerBoundWarning) lines.push("", report.lowerBoundWarning);
  if (report.liveInsertBlockedReason) lines.push("", `LIVE INSERT BLOCKED: ${report.liveInsertBlockedReason}`);
  if (report.reconciliationErrors.length > 0) {
    lines.push("", "Reconciliation errors");
    for (const error of report.reconciliationErrors) lines.push(`- ${error}`);
  } else {
    lines.push("", "Reconciliation: ok");
  }
  return `${lines.join("\n")}\n`;
}
