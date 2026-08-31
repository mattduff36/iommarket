import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { createRunId } from "../archive/paths";
import { listDealers } from "../registry";
import type { DealerRecord } from "../types";
import { writeDealerEvidence, type DealerInspectEvidence } from "./evidence";
import { inspectDealerHeaded } from "./headed";
import { shouldInspectDealer } from "./links";

export function inspectRoot(override?: string) {
  return resolve(override ?? process.env.DEALER_STOCK_INSPECT_DIR ?? "private/dealer-stock-inspect");
}

export interface ArchiveDealerSummary {
  dealerKey: string;
  uniqueVehicles: number;
  importable: number;
}

export function pickInspectTargets(
  dealers: readonly DealerRecord[],
  summaries: ArchiveDealerSummary[],
) {
  const byKey = new Map(summaries.map((item) => [item.dealerKey, item]));
  return dealers
    .map((dealer) => {
      const summary = byKey.get(dealer.key) ?? { dealerKey: dealer.key, uniqueVehicles: 0, importable: 0 };
      const hasUrl = Boolean(dealer.website || dealer.stockUrls[0]);
      const decision = shouldInspectDealer({
        dealerKey: dealer.key,
        uniqueVehicles: summary.uniqueVehicles,
        hasUrl,
      });
      return { dealer, summary, decision };
    })
    .filter((item) => item.decision.inspect);
}

export async function readArchiveSummaries(runManifestPath: string): Promise<ArchiveDealerSummary[]> {
  const raw = JSON.parse(await readFile(runManifestPath, "utf8")) as {
    results?: Array<{ dealerKey: string; uniqueVehicles?: number; importable?: number }>;
  };
  return (raw.results ?? []).map((item) => ({
    dealerKey: item.dealerKey,
    uniqueVehicles: item.uniqueVehicles ?? 0,
    importable: item.importable ?? 0,
  }));
}

export async function runHeadedInspect(input: {
  archiveRunId: string;
  archiveManifestPath: string;
  inspectRunId?: string;
  root?: string;
  onProgress?: (line: string) => void;
}) {
  const inspectRunId = input.inspectRunId ?? createRunId();
  const root = inspectRoot(input.root);
  const runDir = join(root, inspectRunId);
  await mkdir(runDir, { recursive: true });
  const summaries = await readArchiveSummaries(input.archiveManifestPath);
  const targets = pickInspectTargets(listDealers({ includeUnverified: true, includeOptional: true }), summaries);
  const results: DealerInspectEvidence[] = [];

  for (const target of targets) {
    const dealer = target.dealer;
    input.onProgress?.(`Inspecting ${dealer.key} (${target.decision.kind})...`);
    const evidenceDir = join(runDir, dealer.key);
    try {
      const startUrls = [...new Set([dealer.website, ...dealer.stockUrls].filter((item): item is string => Boolean(item)))];
      const evidence = await inspectDealerHeaded({
        dealerKey: dealer.key,
        displayName: dealer.displayName,
        connectorKey: dealer.connectorKey,
        startUrls,
        archiveUnique: target.summary.uniqueVehicles,
        archiveImportable: target.summary.importable,
        kind: target.decision.kind === "partial" ? "partial" : "zero",
        evidenceDir,
      });
      await writeDealerEvidence(evidenceDir, evidence);
      results.push(evidence);
      input.onProgress?.(
        `${dealer.key}: ${evidence.conclusion} cards=${evidence.maxVisibleCards} json=${evidence.jsonPayloadCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: DealerInspectEvidence = {
        dealerKey: dealer.key,
        displayName: dealer.displayName,
        connectorKey: dealer.connectorKey,
        archiveUnique: target.summary.uniqueVehicles,
        archiveImportable: target.summary.importable,
        kind: target.decision.kind === "partial" ? "partial" : "zero",
        skipReason: null,
        conclusion: "navigation_failed",
        suggestedStockUrls: [],
        clickedHrefs: [],
        pages: [
          {
            url: dealer.website ?? dealer.stockUrls[0] ?? "",
            title: "",
            screenshotRel: null,
            priceLikeCards: 0,
            priceSamples: [],
            jsonUrls: [],
            blocked: false,
            facebook: false,
            error: message,
          },
        ],
        maxVisibleCards: 0,
        jsonPayloadCount: 0,
      };
      await writeDealerEvidence(evidenceDir, failed);
      results.push(failed);
      input.onProgress?.(`${dealer.key}: failed ${message}`);
    }
  }

  await writeFile(join(runDir, "inspect.json"), `${JSON.stringify({ inspectRunId, archiveRunId: input.archiveRunId, results }, null, 2)}\n`);
  return { inspectRunId, runDir, results };
}

