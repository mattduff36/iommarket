import { getConnector } from "./connectors/detect";
import { sleep } from "./rate-limit";
import { guardOceanScope, reconcileDealerVehicles, reconcileSourceCounts, successfulRawCount } from "./reconcile";
import type { CanonicalVehicle, DealerRecord, PipelineResult, ProbeResult, SourceListResult } from "./types";

export async function withSourceTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out after 90s")), 90_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function cloneVehicle(vehicle: CanonicalVehicle): CanonicalVehicle {
  return {
    ...vehicle,
    imageUrls: [...vehicle.imageUrls],
    provenance: {
      ...vehicle.provenance,
      sourceKeys: [...vehicle.provenance.sourceKeys],
      rawIdentityHints: [...vehicle.provenance.rawIdentityHints],
    },
  };
}

function cloneSourceResults(sourceResults: SourceListResult[]): SourceListResult[] {
  return sourceResults.map((source) => ({
    ...source,
    vehicles: source.vehicles.map(cloneVehicle),
  }));
}

export function pipelineResultFromSources(input: {
  dealer: DealerRecord;
  sourceResults: SourceListResult[];
  scrapeStartedAt: string;
  scrapeFinishedAt: string;
}): PipelineResult {
  const sourceResults = cloneSourceResults(input.sourceResults);
  const guarded = guardOceanScope(sourceResults);
  return {
    dealer: input.dealer,
    sourceResults: guarded.sourceResults,
    reconciled: reconcileDealerVehicles(sourceResults),
    canArchive: !guarded.blocked && sourceResults.some((result) => result.status === "ok"),
    scrapeStartedAt: input.scrapeStartedAt,
    scrapeFinishedAt: input.scrapeFinishedAt,
  };
}

export async function probeDealer(dealer: DealerRecord): Promise<ProbeResult> {
  const source = dealer.sources[0];
  if (!source) {
    return {
      dealerKey: dealer.key,
      displayName: dealer.displayName,
      website: dealer.website,
      stockUrls: dealer.stockUrls,
      detectedPlatform: null,
      selectedConnector: dealer.connectorKey,
      status: "no_public_stock",
      evidence: ["No configured sources"],
    };
  }
  const connector = getConnector(source.connectorKey);
  return connector.probe({ dealer, source });
}

function soldListCardWithSourceId(vehicle: CanonicalVehicle) {
  return vehicle.availability === "sold" && Boolean(vehicle.sourceVehicleId?.trim());
}

function mergeListedDetails(listed: CanonicalVehicle[], enriched: CanonicalVehicle[]) {
  let index = 0;
  return listed.map((vehicle) => {
    if (soldListCardWithSourceId(vehicle)) return vehicle;
    const next = enriched[index];
    index += 1;
    return next ?? vehicle;
  });
}

export async function runDealerPipeline(
  dealer: DealerRecord,
  options: { fetchImpl?: typeof fetch; delayMs?: number } = {},
): Promise<PipelineResult> {
  const scrapeStartedAt = new Date().toISOString();
  const sourceResults: SourceListResult[] = [];
  const delayMs = options.delayMs ?? 800;

  for (const source of dealer.sources) {
    const connector = getConnector(source.connectorKey);
    const context = { dealer, source, fetchImpl: options.fetchImpl, delayMs };
    try {
      let listed = await withSourceTimeout(connector.fetchList(context));
      // A rendered public list can briefly contain no stock while the site is
      // loading. Retry only a completed, closed read, never an ongoing timeout.
      for (let retry = 0; retry < 2 && listed.status === "failed" &&
        listed.error === "No structured public stock records found"; retry++) {
        await sleep(1_000 * (retry + 1));
        listed = await withSourceTimeout(connector.fetchList(context));
      }
      if (listed.status === "ok") {
        const needsDetails = listed.vehicles.filter((vehicle) => !soldListCardWithSourceId(vehicle));
        const enriched = needsDetails.length === 0
          ? { vehicles: [], detailMissing: 0 }
          : await connector.fetchDetails(context, needsDetails);
        sourceResults.push({
          ...listed,
          vehicles: mergeListedDetails(listed.vehicles, enriched.vehicles),
          detailMissing: (enriched.detailMissing ?? 0) + Math.abs(needsDetails.length - enriched.vehicles.length),
        });
      } else {
        sourceResults.push(listed);
      }
    } catch (error) {
      sourceResults.push({
        dealerKey: dealer.key,
        sourceKey: source.key,
        platform: source.connectorKey,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        startUrl: source.startUrl,
        pagesFetched: 0,
        advertisedCount: null,
        rawCount: null,
        vehicles: [],
      });
    }
    await sleep(delayMs);
  }

  return pipelineResultFromSources({
    dealer,
    sourceResults,
    scrapeStartedAt,
    scrapeFinishedAt: new Date().toISOString(),
  });
}

export function pipelineWarnings(result: PipelineResult) {
  return [
    ...reconcileSourceCounts(result.sourceResults),
    ...result.sourceResults
      .filter((item) => item.status !== "ok")
      .map((item) => `${item.sourceKey}: ${item.status} ${item.error ?? ""}`.trim()),
    `raw=${successfulRawCount(result.sourceResults)} unique=${result.reconciled.length}`,
  ];
}
