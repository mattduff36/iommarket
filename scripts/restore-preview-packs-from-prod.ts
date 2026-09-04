/**
 * Remap-copy dealer preview packs from production into the preview database.
 * Production is read-only. Packs are restored hidden.
 *
 * npm run preview-packs:restore-from-prod
 * npm run preview-packs:restore-from-prod -- --apply --allow=1 --source-ref=... --dest-ref=... --confirm-db=... --confirm=...
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadMirrorEnvs, previewCandidates, productionCandidates } from "./prod-mirror/cli-env";
import { createReadPool, createWritePool } from "./prod-mirror/db";
import { chooseDirectConnectionString, redactedConfirmDb } from "./prod-mirror/target";
import { applyRestorePlan, buildRestorePlan } from "./restore-preview-packs-from-prod/copy";
import {
  APPLY_CONFIRM_TOKEN,
  assertRestoreSafety,
  PREVIEW_CONFIRM_DB,
} from "./restore-preview-packs-from-prod/safety";

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

function createClient(url: string, mode: "read" | "write") {
  const pool = mode === "write" ? createWritePool(url) : createReadPool(url);
  return {
    pool,
    prisma: new PrismaClient({ adapter: new PrismaPg(pool) }),
  };
}

async function main() {
  const envs = loadMirrorEnvs(process.argv);
  const previewUrl = chooseDirectConnectionString(previewCandidates(envs.preview), "preview");
  const productionUrl = chooseDirectConnectionString(
    productionCandidates(envs.production),
    "production",
  );
  const destConfirmDb = redactedConfirmDb(previewUrl);
  const args = assertRestoreSafety({
    argv: process.argv,
    destConfirmDb,
  });
  if (destConfirmDb !== PREVIEW_CONFIRM_DB) {
    throw new Error("Refusing restore: parsed preview URL is not the preview database.");
  }

  const source = createClient(productionUrl, "read");
  const dest = createClient(previewUrl, args.apply ? "write" : "read");
  try {
    const plan = await buildRestorePlan({
      source: source.prisma,
      dest: dest.prisma,
    });
    write(
      `source=${redactedConfirmDb(productionUrl)} dest=${destConfirmDb} dryRun=${args.dryRun}`,
    );
    write(
      `packs=${plan.packs.length} listings=${plan.listings.length} accounts=${plan.accounts.length} oceanSkipped=${plan.skippedOcean.length}`,
    );
    for (const pack of plan.packs) {
      const listingCount = plan.listings.filter((listing) => listing.dealerKey === pack.dealerKey)
        .length;
      write(`  ${pack.displayName} (${pack.dealerKey}) listings=${listingCount} hidden`);
    }
    if (args.dryRun) {
      write("Dry-run only. Re-run with --apply and the confirm token to write preview.");
      write(`Confirm token: ${APPLY_CONFIRM_TOKEN}`);
      return;
    }
    const result = await applyRestorePlan({ dest: dest.prisma, plan });
    write(
      `applied createdPacks=${result.createdPacks} createdListings=${result.createdListings} createdImages=${result.createdImages} skippedPacks=${result.skippedPacks}`,
    );
  } finally {
    await Promise.allSettled([
      source.prisma.$disconnect(),
      dest.prisma.$disconnect(),
      source.pool.end(),
      dest.pool.end(),
    ]);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
