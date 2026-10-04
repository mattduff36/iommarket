import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import { matchMediaReference } from "@/lib/media/match-reference";

const developmentRef = "syneonzucehwlghqmfbg";
const productionRef = "snlqivvogfqesxpbjiei";

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes(developmentRef) || databaseUrl.includes(productionRef)) {
    throw new Error("Backfill refused: target is not the verified development database.");
  }
  if (process.argv.includes("--apply")) {
    throw new Error("Backfill apply is refused on the shared development database until the schema migration is part of the deployed migration history.");
  }
  const mapPath = process.env.IMAGEKIT_MIGRATION_MAP;
  if (!mapPath) throw new Error("IMAGEKIT_MIGRATION_MAP is not configured.");
  const index = loadMigrationIndex(mapPath);
  const images = await db.listingImage.findMany({
    select: { id: true, provider: true, assetId: true, publicId: true, version: true, url: true },
  });
  let exact = 0;
  let skipped = 0;
  for (const image of images) {
    const match = matchMediaReference(image, index);
    if (match.asset) exact += 1;
    else skipped += 1;
  }
  const report = {
    mode: "dry-run",
    exactMatchesThatWouldStoreFileId: exact,
    skipped: skipped,
    writes: 0,
  };
  writeFileSync("tmp/imagekit-backfill-dry-run.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
