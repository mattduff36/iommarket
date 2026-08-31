import { getConnector } from "./connectors/detect";
import { sleep } from "./rate-limit";
import { reconcileDealerVehicles, reconcileSourceCounts, successfulRawCount } from "./reconcile";
import type { DealerRecord, PipelineResult, ProbeResult, SourceListResult } from "./types";

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
      const listed = await Promise.race([
        connector.fetchList(context),
        sleep(90_000).then(() => {
          throw new Error("Timed out after 90s");
        }),
      ]);
      if (listed.status === "ok") {
        const enriched = await connector.fetchDetails(context, listed.vehicles);
        sourceResults.push({
          ...listed,
          vehicles: enriched.vehicles,
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

  const reconciled = reconcileDealerVehicles(sourceResults);
  return {
    dealer,
    sourceResults,
    reconciled,
    canArchive: sourceResults.some((result) => result.status === "ok"),
    scrapeStartedAt,
    scrapeFinishedAt: new Date().toISOString(),
  };
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
