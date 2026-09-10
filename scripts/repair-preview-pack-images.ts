/**
 * Replace preview-pack listing images with canonical full-size sources.
 * Preview database only. Default is dry-run.
 *
 * npm run repair:preview-pack-images -- --allow=1 --dest-ref=<preview> --confirm-db=<preview db> --all-affected
 * npm run repair:preview-pack-images -- --allow=1 --dest-ref=<preview> --confirm-db=<preview db> \
 *   --dealer=rex-motor-company --snapshot=<runId> --plan-fingerprint=<sha> --plan-count=<n> \
 *   --apply --confirm="yes repair preview pack images <preview>"
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { scrapeOceanRepairVehicles } from "./ocean-inventory/repair-source";
import { runPreviewPackImageRepair } from "./repair-preview-pack-images/run";
import {
  PREVIEW_ENV_FILE,
  assertExactPreviewRepairEnvironment,
  assertPreviewPackRepairSafety,
} from "./repair-preview-pack-images/safety";

function loadPreviewEnv(cwd = process.cwd()) {
  dotenv.config({ path: resolve(cwd, PREVIEW_ENV_FILE) });
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return assertExactPreviewRepairEnvironment({ databaseUrl, supabaseUrl });
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

async function main(argv = process.argv.slice(2)) {
  const args = assertPreviewPackRepairSafety({ argv });
  const databaseUrl = loadPreviewEnv();
  const pool = new pg.Pool({
    connectionString: cleanUrl(databaseUrl),
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await runPreviewPackImageRepair({
      args,
      prisma,
      scrapeOceanVehicles: scrapeOceanRepairVehicles,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Preview pack image repair failed."}\n`);
  process.exitCode = 1;
});
