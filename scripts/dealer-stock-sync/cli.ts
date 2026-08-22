/**
 * Dealer stock probe / archive / dry-run import.
 *
 * npm run dealer-stock:probe -- --dealer athol-garage
 * npm run dealer-stock:archive -- --dealer athol-garage
 * npm run dealer-stock:archive -- --all
 * npm run dealer-stock:archive -- --all --no-images
 * npm run dealer-stock:import -- --dealer athol-garage --expected-name "Athol Garage" --snapshot <runId>
 * npm run dealer-stock:inspect -- --zeros-and-partials
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { writeDealerArchive, writeRunManifest } from "./archive/write";
import { archiveRoot, createRunId } from "./archive/paths";
import { dryRunArchiveImport } from "./import-from-archive";
import type { DealerInspectEvidence } from "./inspect/evidence";
import { collectLatestDealerCounts, writeInspectReport } from "./inspect/report";
import { inspectRoot, runHeadedInspect } from "./inspect/run";
import { probeDealer, runDealerPipeline } from "./pipeline";
import { DEALER_REGISTRY, getDealer, listDealers } from "./registry";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

async function probe() {
  const dealerKey = argValue("--dealer");
  const dealers = dealerKey ? [getDealer(dealerKey)] : listDealers({ includeUnverified: true, includeOptional: true });
  for (const dealer of dealers) {
    const result = await probeDealer(dealer);
    write(JSON.stringify(result, null, 2));
  }
}

async function archive() {
  const dealerKey = argValue("--dealer");
  const all = hasFlag("--all");
  const mirrorImages = !hasFlag("--no-images");
  if (!dealerKey && !all) {
    throw new Error("Pass --dealer <key> or --all");
  }
  const dealers = dealerKey
    ? [getDealer(dealerKey)]
    : listDealers({ includeUnverified: true, includeOptional: true });
  const runId = createRunId();
  const manifests = [];
  for (const dealer of dealers) {
    write(`Archiving ${dealer.key}...`);
    try {
      const result = await runDealerPipeline(dealer);
      const written = await writeDealerArchive({
        result,
        runId,
        mirrorImages,
      });
      manifests.push(written.manifest);
      write(
        `${dealer.key}: status=${written.manifest.canArchive ? "ok" : "incomplete"} unique=${written.manifest.uniqueVehicles} importable=${written.manifest.importable}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manifests.push({ dealerKey: dealer.key, error: message, canArchive: false });
      write(`${dealer.key}: failed ${message}`);
    }
  }
  await writeRunManifest({ runId, dealers: [...DEALER_REGISTRY], dealerManifests: manifests });
  write(`Run complete: ${runId}`);
}

async function importer() {
  const dealerKey = argValue("--dealer");
  const expectedName = argValue("--expected-name");
  const snapshot = argValue("--snapshot");
  if (!dealerKey || !expectedName || !snapshot) {
    throw new Error("Require --dealer, --expected-name and --snapshot");
  }
  const report = await dryRunArchiveImport({
    dealerKey,
    expectedName,
    runId: snapshot,
    apply: hasFlag("--apply"),
  });
  write(JSON.stringify(report, null, 2));
}

async function inspect() {
  if (hasFlag("--refresh-report")) {
    const inspectRunId = argValue("--inspect-run");
    if (!inspectRunId) throw new Error("Pass --inspect-run <id> with --refresh-report");
    const inspectDir = join(inspectRoot(), inspectRunId);
    const inspectJson = JSON.parse(await readFile(join(inspectDir, "inspect.json"), "utf8")) as {
      archiveRunId: string;
      results: DealerInspectEvidence[];
    };
    const reportPath = await writeInspectReport({
      inspectRunId,
      archiveRunId: inspectJson.archiveRunId,
      inspectDir,
      results: inspectJson.results,
      afterAdapter: await collectLatestDealerCounts(),
    });
    write(`Report: ${reportPath}`);
    return;
  }
  if (!hasFlag("--zeros-and-partials") && !argValue("--dealer")) {
    throw new Error("Pass --zeros-and-partials, --dealer <key>, or --refresh-report");
  }
  const snapshot = argValue("--snapshot");
  const latest = JSON.parse(await readFile(join(archiveRoot(), "latest.json"), "utf8")) as {
    runId: string;
    dir: string;
  };
  const archiveRunId = snapshot ?? latest.runId;
  const archiveManifestPath = join(archiveRoot(), "runs", archiveRunId, "manifest.json");
  const result = await runHeadedInspect({
    archiveRunId,
    archiveManifestPath,
    onProgress: write,
  });
  const reportPath = await writeInspectReport({
    inspectRunId: result.inspectRunId,
    archiveRunId,
    inspectDir: result.runDir,
    results: result.results,
    afterAdapter: await collectLatestDealerCounts(),
  });
  write(`Inspect complete: ${result.inspectRunId}`);
  write(`Report: ${reportPath}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "probe") return probe();
  if (command === "archive") return archive();
  if (command === "import") return importer();
  if (command === "inspect") return inspect();
  throw new Error("Usage: dealer-stock-sync <probe|archive|import|inspect>");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
