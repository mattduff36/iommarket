/** Staging only. Dry-run by default; --apply applies evidence with optimistic concurrency. */
import dotenv from "dotenv";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { databaseSslOptions } from "../lib/db/pool-options";
import { isAllowedPreviewDatabaseUrl } from "./wipe-preview-marketplace/target";
import { resolveConditionEvidence, stockRouteCondition } from "../lib/listings/condition";
import { archiveRoot } from "./dealer-stock-sync/archive/paths";

dotenv.config({ path: ".env.local", quiet: true });
const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
if (!isAllowedPreviewDatabaseUrl(connectionString)) throw new Error("Condition backfill requires the verified staging database.");
const pool = new pg.Pool({ connectionString, ssl: databaseSslOptions(connectionString!) });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const evidenceByUrl = new Map<string, unknown[]>();
  // Most recent archived observation wins; ambiguous evidence within it remains flagged.
  const runs = await readdir(join(archiveRoot(), "runs")).catch(() => [] as string[]);
  for (const run of runs.sort().reverse()) {
    const root = join(archiveRoot(), "runs", run);
    for (const dealer of await readdir(root, { withFileTypes: true })) {
      if (!dealer.isDirectory()) continue;
      const raw = await readFile(join(root, dealer.name, "vehicles.json"), "utf8").catch(() => null);
      if (!raw) continue;
      const records: unknown = JSON.parse(raw);
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const vehicle = record?.vehicle;
        if (typeof vehicle?.detailUrl !== "string" || evidenceByUrl.has(vehicle.detailUrl)) continue;
        evidenceByUrl.set(vehicle.detailUrl, [vehicle.condition, stockRouteCondition(vehicle.provenance?.startUrl), stockRouteCondition(vehicle.detailUrl)]);
      }
    }
  }
  const listings = await db.listing.findMany({
    where: { conditionReviewRequired: true },
    include: { attributeValues: { include: { attributeDefinition: true } } },
  });
  const plan = listings.map((listing) => {
    const attributes = listing.attributeValues.filter((value) => ["condition", "vehicle-condition", "new-used"].includes(value.attributeDefinition.slug));
    const result = resolveConditionEvidence([
      ...attributes.map((value) => value.value),
      stockRouteCondition(listing.reviewSourceUrl),
      ...(evidenceByUrl.get(listing.reviewSourceUrl ?? "") ?? []),
    ]);
    return { id: listing.id, updatedAt: listing.updatedAt, previous: listing.condition,
      ...result, evidence: attributes.map((value) => ({ slug: value.attributeDefinition.slug, value: value.value })),
      archiveEvidence: evidenceByUrl.get(listing.reviewSourceUrl ?? "") ?? [] };
  });
  const uncertain = plan.filter((row) => row.reviewRequired).length;
  await mkdir("private/condition-backfill", { recursive: true });
  const report = `private/condition-backfill/${Date.now()}.json`;
  await writeFile(report, JSON.stringify({ uncertain, plan }, null, 2));
  if (process.argv.includes("--apply")) {
    await db.$transaction(async (tx) => {
      for (const row of plan) {
        const updated = await tx.listing.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt, conditionReviewRequired: true },
          data: { condition: row.condition, conditionReviewRequired: row.reviewRequired,
            ...(row.reviewRequired && uncertain <= 10 ? { stockReviewHeld: true } : {}),
            lifecycleRevision: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error(`Listing changed during backfill: ${row.id}`);
      }
    }, { timeout: 180_000 });
  }
  console.log(JSON.stringify({ applied: process.argv.includes("--apply"), count: plan.length,
    new: plan.filter((row) => row.condition === "NEW").length, uncertain, report }));
}
main().finally(async () => { await db.$disconnect(); await pool.end(); });
