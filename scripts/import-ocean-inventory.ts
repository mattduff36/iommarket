/**
 * Preview-only Ocean Ford / Transit Centre / KIA inventory import.
 * Requires .env.local on new-ford-dealership (syneonzucehwlghqmfbg).
 *
 * Dry-run: npx tsx scripts/import-ocean-inventory.ts --dry-run
 * Live:    npx tsx scripts/import-ocean-inventory.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  insertLiveListing,
  loadCatalogIds,
  loadExistingDealerIdentities,
  loadImportDealer,
} from "./import-ocean-inventory/apply";
import {
  EXPECTED_PRO_CAP,
  assertPreviewImportTarget,
  chooseImportConnectionString,
} from "./import-ocean-inventory/target";
import { getDealerListingCap } from "../lib/config/dealer-tiers";
import { runImportPipeline } from "./import-ocean-inventory/pipeline";
import { formatImportReport } from "./import-ocean-inventory/report";
import { fetchClassicVehicleDetail } from "./import-ocean-inventory/classic";
import { isOceanEligibleLocation } from "./import-ocean-inventory/locations";
import {
  enrichFrozenDetails,
  fetchVehicleDetail,
  scrapeAllOceanSources,
} from "./import-ocean-inventory/scrape";
import { normalizeNetDirectorVehicle } from "./import-ocean-inventory/normalize";
import { uploadListingImages } from "./import-ocean-inventory/upload";
import type { NormalizedVehicle } from "./import-ocean-inventory/types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { prisma, pool } = createPrisma();

  try {
    if (getDealerListingCap("PRO") !== EXPECTED_PRO_CAP) {
      throw new Error(`Pro cap is ${getDealerListingCap("PRO")}, expected ${EXPECTED_PRO_CAP}`);
    }

    const dealer = await loadImportDealer(prisma);
    const existing = await loadExistingDealerIdentities(prisma, dealer.dealerId);
    const catalog = await loadCatalogIds(prisma);

    const listed = await scrapeAllOceanSources();
    const enriched = await enrichFrozenDetails(listed.sourceResults, async (sourceKey, vehicle) => {
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

    const pipeline = runImportPipeline({
      sourceResults: enriched.sourceResults,
      existingListings: existing,
      remainingSlots: dealer.remainingSlots,
      scrapeStartedAt: listed.scrapeStartedAt,
      scrapeFinishedAt: new Date(),
      detailMissing: enriched.detailMissing,
      proCap: dealer.cap,
    });

    process.stdout.write(formatImportReport(pipeline.report));

    if (pipeline.report.reconciliationErrors.length > 0) {
      throw new Error("Import report did not reconcile.");
    }

    if (dryRun) {
      process.stdout.write("Dry-run complete. No database or Cloudinary writes.\n");
      return;
    }

    if (!pipeline.canLiveInsert) {
      throw new Error(
        pipeline.report.liveInsertBlockedReason ?? "Live insert is blocked.",
      );
    }

    let inserted = 0;
    let failed = 0;
    for (const outcome of pipeline.selected) {
      const listing = outcome.listing;
      if (!listing) continue;
      try {
        const listingKey =
          outcome.reconciled.vehicle.stockId ??
          outcome.reconciled.identityKey.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const images =
          listing.imageUrls.length > 0
            ? await uploadListingImages({
                userId: dealer.userId,
                listingKey,
                imageUrls: listing.imageUrls,
              })
            : [];
        await prisma.$transaction(async (tx) => {
          await insertLiveListing(tx, {
            userId: dealer.userId,
            dealerId: dealer.dealerId,
            listing,
            images,
            catalog,
          });
        });
        inserted += 1;
      } catch (error) {
        failed += 1;
        process.stderr.write(
          `Failed to import ${listing.title}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }

    process.stdout.write(
      [
        "Live import complete.",
        `inserted=${inserted}`,
        `failed=${failed}`,
        `leftovers=${pipeline.leftovers.length}`,
        `alreadyPresent=${pipeline.report.alreadyPresent}`,
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
