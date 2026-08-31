/**
 * Preview-only Ocean Motor Village listing enrichment from plates.
 * Requires .env.local on new-ford-dealership (syneonzucehwlghqmfbg).
 *
 * Dry-run: npx tsx scripts/enrich-ocean-listings.ts
 * Apply:   npx tsx scripts/enrich-ocean-listings.ts --apply
 * Rollback: npx tsx scripts/enrich-ocean-listings.ts --rollback path/to/snapshot.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { loadImportDealer } from "./import-ocean-inventory/apply";
import {
  applyEnrichmentSnapshot,
  loadEnrichableListings,
  rollbackEnrichmentSnapshot,
} from "./import-ocean-inventory/enrich-apply";
import { parsePlateOverrideFile } from "./import-ocean-inventory/enrich-plates";
import { runEnrichPipeline } from "./import-ocean-inventory/enrich-pipeline";
import { ENRICH_DEFAULT_LOOKUP_DELAY_MS, type EnrichSnapshot } from "./import-ocean-inventory/enrich-types";
import { fetchClassicVehicleDetail } from "./import-ocean-inventory/classic";
import { isOceanEligibleLocation } from "./import-ocean-inventory/locations";
import { normalizeNetDirectorVehicle } from "./import-ocean-inventory/normalize";
import {
  enrichFrozenDetails,
  fetchVehicleDetail,
  scrapeAllOceanSources,
} from "./import-ocean-inventory/scrape";
import {
  assertPreviewImportTarget,
  chooseImportConnectionString,
} from "./import-ocean-inventory/target";
import { getVehicleCheckResult } from "../lib/services/vehicle-check-aggregator";
import type { NormalizedVehicle } from "./import-ocean-inventory/types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const ARTIFACT_DIR = resolve(process.cwd(), ".local/ocean-enrich");

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function cleanUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    return parsed.toString();
  } catch {
    return raw.trim();
  }
}

function createPrisma() {
  assertPreviewImportTarget({
    databaseUrl: process.env.DATABASE_URL,
    postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const connectionString = chooseImportConnectionString({
    databaseUrl: process.env.DATABASE_URL,
    postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString ?? ""),
    ssl: { rejectUnauthorized: false },
  });
  return {
    prisma: new PrismaClient({ adapter: new PrismaPg(pool) }),
    pool,
  };
}

function createRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
}

async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function scrapeSources() {
  const listed = await scrapeAllOceanSources();
  return enrichFrozenDetails(listed.sourceResults, async (sourceKey, vehicle) => {
    if (!isOceanEligibleLocation(vehicle.locationName)) return null;
    const result = listed.sourceResults.find((item) => item.sourceKey === sourceKey);
    const origin = result ? new URL(result.startUrl).origin : null;
    let fromApi: NormalizedVehicle | null = null;
    if (result?.searchContext?.kind !== "classic" && result?.searchContext && vehicle.stockId) {
      const payload = await fetchVehicleDetail({
        context: result.searchContext,
        stockId: vehicle.stockId,
      });
      fromApi = payload ? normalizeNetDirectorVehicle(payload, sourceKey, origin) : null;
    }
    if (!vehicle.detailUrl) return fromApi;
    const fromHtml = await fetchClassicVehicleDetail({ detailUrl: vehicle.detailUrl });
    if (!fromHtml) return fromApi;
    return {
      ...(fromApi ?? vehicle),
      sourceKey,
      description: fromHtml.description || fromApi?.description || vehicle.description,
      imageUrls: [...(fromApi?.imageUrls ?? vehicle.imageUrls), ...fromHtml.imageUrls],
    };
  });
}

async function writeJson(path: string, value: unknown) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const apply = hasFlag("--apply");
  const rollbackPath = argValue("--rollback");
  const platesPath = argValue("--plates");
  const delayRaw = argValue("--lookup-delay-ms");
  const delayMs = delayRaw ? Number(delayRaw) : ENRICH_DEFAULT_LOOKUP_DELAY_MS;
  const { prisma, pool } = createPrisma();

  try {
    const dealer = await loadImportDealer(prisma);

    if (rollbackPath) {
      const snapshot = JSON.parse(await readFile(rollbackPath, "utf8")) as EnrichSnapshot;
      await rollbackEnrichmentSnapshot(prisma, snapshot, dealer.dealerId);
      process.stdout.write(`Rollback complete for ${snapshot.runId}\n`);
      return;
    }

    const listings = await loadEnrichableListings(prisma, dealer.dealerId);
    const scraped = await scrapeSources();
    const overrides = platesPath
      ? parsePlateOverrideFile(JSON.parse(await readFile(platesPath, "utf8")))
      : undefined;

    const runId = createRunId();
    const snapshotPath = resolve(ARTIFACT_DIR, `snapshot-${runId}.json`);
    let snapshotPersisted = false;
    const result = await runEnrichPipeline({
      dealerId: dealer.dealerId,
      listings,
      sourceResults: scraped.sourceResults,
      overrides,
      lookup: (registration) => getVehicleCheckResult(registration),
      sleep,
      delayMs: Number.isFinite(delayMs) ? delayMs : ENRICH_DEFAULT_LOOKUP_DELAY_MS,
      apply,
      runId,
      createdAt: new Date().toISOString(),
      persistSnapshot: async (snapshot) => {
        await writeJson(snapshotPath, snapshot);
        snapshotPersisted = true;
      },
      applySnapshot: (snapshot) => applyEnrichmentSnapshot(prisma, snapshot, dealer.dealerId),
    });

    const reportPath = resolve(ARTIFACT_DIR, `report-${runId}.json`);
    const leftoverPath = resolve(ARTIFACT_DIR, `leftovers-${runId}.json`);
    await writeJson(reportPath, result.report);
    await writeJson(leftoverPath, {
      listings: result.report.leftovers,
      skipped: result.report.skipped,
    });
    if (result.snapshot && !snapshotPersisted) {
      await writeJson(snapshotPath, result.snapshot);
    }
    if (result.snapshot) {
      process.stdout.write(`snapshot=${snapshotPath}\n`);
    }

    process.stdout.write(
      [
        apply ? (result.applied ? "Apply complete." : "Apply requested but nothing to write.") : "Dry-run complete. No database writes.",
        `listings=${listings.length}`,
        `leftovers=${result.report.leftovers.length}`,
        `planned=${result.report.counts.applied ?? 0}`,
        `report=${reportPath}`,
        `leftoverManifest=${leftoverPath}`,
        "",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
