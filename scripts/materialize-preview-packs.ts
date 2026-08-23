/**
 * Load remaining admin preview packs from the local archive.
 * Resumes interrupted packs and backfills listings that still need photos.
 *
 * npm run preview-packs:materialize
 * npm run preview-packs:materialize -- --dealer athol-garage
 * npm run preview-packs:materialize -- --dry-run
 * npm run preview-packs:materialize -- --leave-hidden
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { db } from "../lib/db";
import {
  listAvailablePreviewArchives,
  mergePreviewPackRows,
} from "../lib/preview-packs/archive";
import {
  inspectPreviewPack,
  materializePreviewPack,
  setPreviewPackEnabled,
} from "../lib/preview-packs/materialize";
import { assertPreviewDealerAllowed } from "../lib/preview-packs/safety";
import {
  packNeedsUpload,
  parseMaterializeArgs,
  selectedPreviewPacks,
} from "./materialize-preview-packs/args";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

function write(line: string) {
  process.stdout.write(`${line}\n`);
}

async function loadRows() {
  const [archive, packs] = await Promise.all([
    listAvailablePreviewArchives(),
    db.dealerPreviewPack.findMany({
      include: {
        _count: { select: { listings: true } },
        dealerProfile: { select: { slug: true } },
      },
    }),
  ]);
  return mergePreviewPackRows({
    archives: archive.dealers,
    packs: packs.map((pack) => ({
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      enabled: pack.enabled,
      sourceRunId: pack.sourceRunId,
      listingCount: pack._count.listings,
      slug: pack.dealerProfile.slug,
    })),
  });
}

async function main() {
  const args = parseMaterializeArgs(process.argv);
  const selected = selectedPreviewPacks(await loadRows(), args.dealerKey);
  if (args.dealerKey && selected.length === 0) {
    throw new Error(
      `No preview pack for ${args.dealerKey}. It may be missing from the archive or excluded.`,
    );
  }

  const inspections = [];
  for (const pack of selected) {
    assertPreviewDealerAllowed({ dealerKey: pack.dealerKey });
    const inspect = await inspectPreviewPack(pack.dealerKey);
    inspections.push({ pack, inspect });
    write(
      `${inspect.displayName} (${pack.dealerKey}): listings+${inspect.summary.create} photos+${inspect.summary.missingImages} complete=${inspect.summary.complete}`,
    );
  }

  const pending = inspections.filter(({ inspect }) => packNeedsUpload(inspect.summary));
  write(
    pending.length === 0
      ? "Nothing left to upload."
      : `${args.dryRun ? "Dry-run" : "Uploading"} ${pending.length} pack(s).`,
  );
  if (args.dryRun) return;

  for (const { pack, inspect } of pending) {
    write(`Materializing ${inspect.displayName} (${pack.dealerKey})...`);
    const result = await materializePreviewPack(pack.dealerKey);
    if (args.leaveHidden) {
      await setPreviewPackEnabled(pack.dealerKey, false);
    }
    write(
      `  created=${result.created} backfilled=${result.backfilled} skipped=${result.skipped}${
        args.leaveHidden ? " hidden" : " visible"
      }`,
    );
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
