import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { db } from "@/lib/db";
import { assertIsolatedLocalDatabase, decideImageKitBackfill } from "@/lib/media/backfill-decision";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import { matchMediaReference } from "@/lib/media/match-reference";

type BackfillRow = {
  id: string;
  provider: string;
  assetId: string | null;
  publicId: string;
  version: string | null;
  url: string;
  imageKitFileId: string | null;
  imageKitFilePath: string | null;
};

const auditPath = "tmp/imagekit-backfill-audit.jsonl";

function databaseUrl() {
  return process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "";
}

function migrationMapPath() {
  if (process.env.IMAGEKIT_MIGRATION_MAP) return process.env.IMAGEKIT_MIGRATION_MAP;
  const text = readFileSync(".env.local", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("IMAGEKIT_MIGRATION_MAP="));
  return line?.slice("IMAGEKIT_MIGRATION_MAP=".length).replace(/^"(.*)"$/, "$1") ?? "";
}

async function main() {
  const url = databaseUrl();
  assertIsolatedLocalDatabase(url);
  const apply = process.argv.includes("--apply");
  const mapPath = migrationMapPath();
  if (!mapPath) throw new Error("IMAGEKIT_MIGRATION_MAP is not configured.");
  const index = loadMigrationIndex(mapPath);
  const [images, revisions] = await Promise.all([
    db.listingImage.findMany({
      select: {
        id: true, provider: true, assetId: true, publicId: true, version: true, url: true,
        imageKitFileId: true, imageKitFilePath: true,
      },
    }),
    db.listingRevisionImage.findMany({
      select: {
        id: true, provider: true, assetId: true, publicId: true, version: true, url: true,
        imageKitFileId: true, imageKitFilePath: true,
      },
    }),
  ]);
  const audit: string[] = [];
  const counts = { write: 0, unchanged: 0, refuse: 0, applied: 0 };
  async function consider(table: "listingImage" | "listingRevisionImage", row: BackfillRow) {
    const decision = decideImageKitBackfill({
      match: matchMediaReference(row, index),
      reference: row,
    });
    if (decision.action === "refuse") {
      counts.refuse += 1;
      audit.push(JSON.stringify({ table, id: row.id, provider: row.provider, publicId: row.publicId, reason: decision.reason }));
      return;
    }
    counts[decision.action] += 1;
    if (!apply || decision.action !== "write") return;
    const data = { imageKitFileId: decision.fileId, imageKitFilePath: decision.filePath };
    if (table === "listingImage") await db.listingImage.update({ where: { id: row.id }, data });
    else await db.listingRevisionImage.update({ where: { id: row.id }, data });
    counts.applied += 1;
  }
  for (const row of images) await consider("listingImage", row);
  for (const row of revisions) await consider("listingRevisionImage", row);
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(auditPath, audit.length ? `${audit.join("\n")}\n` : "");
  const report = { mode: apply ? "apply" : "dry-run", ...counts, auditRows: audit.length, writes: apply ? counts.applied : 0 };
  writeFileSync("tmp/imagekit-backfill-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
