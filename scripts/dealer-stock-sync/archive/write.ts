import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { compareSnapshot, missingAfterSuccess } from "../identity";
import { mapReconciledVehicle } from "../map-listing";
import { pipelineWarnings } from "../pipeline";
import type { ArchivedVehicle, DealerRecord, PipelineResult } from "../types";
import { archiveImages } from "./images";
import { archiveRoot, dealerDir, runDir } from "./paths";

export async function writeDealerArchive(input: {
  result: PipelineResult;
  runId: string;
  root?: string;
  previous?: Array<{ identityKey: string; contentHash: string }>;
  mirrorImages?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const root = archiveRoot(input.root);
  const dir = dealerDir(root, input.runId, input.result.dealer.key);
  await mkdir(join(dir, "raw"), { recursive: true });
  await mkdir(join(dir, "images"), { recursive: true });

  const sourceFailed = !input.result.sourceResults.some((item) => item.status === "ok");
  const currentKeys = new Set(input.result.reconciled.map((item) => item.identityKey));
  const vehicles: ArchivedVehicle[] = [];

  for (const reconciled of input.result.reconciled) {
    const mapped = mapReconciledVehicle(reconciled);
    const images = await archiveImages({
      imageDir: join(dir, "images", reconciled.identityKey.replace(/[^a-zA-Z0-9._-]+/g, "-")),
      imageUrls: reconciled.vehicle.imageUrls,
      fetchImpl: input.fetchImpl,
      enabled: input.mirrorImages,
    });
    vehicles.push({
      ...reconciled,
      importable: Boolean(mapped.listing),
      importSkipReason: mapped.skipReason,
      images,
      changeKind: compareSnapshot(input.previous ?? null, reconciled, sourceFailed),
    });
  }

  const manifest = {
    dealerKey: input.result.dealer.key,
    displayName: input.result.dealer.displayName,
    website: input.result.dealer.website,
    stockUrls: input.result.dealer.stockUrls,
    connectorKey: input.result.dealer.connectorKey,
    scrapeStartedAt: input.result.scrapeStartedAt,
    scrapeFinishedAt: input.result.scrapeFinishedAt,
    sources: input.result.sourceResults.map((source) => ({
      key: source.sourceKey,
      status: source.status,
      error: source.error,
      startUrl: source.startUrl,
      pagesFetched: source.pagesFetched,
      advertisedCount: source.advertisedCount,
      rawCount: source.rawCount,
      retrieved: source.vehicles.length,
    })),
    rawRecords: input.result.sourceResults.reduce((sum, item) => sum + item.vehicles.length, 0),
    uniqueVehicles: vehicles.length,
    importable: vehicles.filter((item) => item.importable).length,
    imagesOk: vehicles.reduce((sum, item) => sum + item.images.filter((image) => image.status === "ok").length, 0),
    missingAfterSuccess: missingAfterSuccess(input.previous ?? null, currentKeys, sourceFailed),
    warnings: pipelineWarnings(input.result),
    canArchive: input.result.canArchive,
  };

  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dir, "vehicles.json"), `${JSON.stringify(vehicles, null, 2)}\n`);
  await writeFile(join(dir, "errors.json"), `${JSON.stringify(manifest.warnings, null, 2)}\n`);
  await writeFile(
    join(dir, "raw", "sources.json"),
    `${JSON.stringify(
      input.result.sourceResults.map((item) => ({
        ...item,
        rawRecords: item.rawRecords ?? [],
      })),
      null,
      2,
    )}\n`,
  );

  return { dir, manifest, vehicles };
}

export async function writeRunManifest(input: {
  runId: string;
  dealers: DealerRecord[];
  dealerManifests: unknown[];
  root?: string;
}) {
  const root = archiveRoot(input.root);
  const dir = runDir(root, input.runId);
  await mkdir(dir, { recursive: true });
  const manifest = {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    dealers: input.dealers.map((dealer) => dealer.key),
    results: input.dealerManifests,
  };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, "latest.json"), `${JSON.stringify({ runId: input.runId, dir }, null, 2)}\n`);
  await writeFile(join(root, "registry.json"), `${JSON.stringify(input.dealers, null, 2)}\n`);
  return manifest;
}
