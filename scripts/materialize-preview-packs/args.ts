export interface MaterializeCliArgs {
  dealerKey: string | null;
  dryRun: boolean;
  leaveHidden: boolean;
}

export function parseMaterializeArgs(argv: string[]): MaterializeCliArgs {
  const index = argv.indexOf("--dealer");
  return {
    dealerKey: index >= 0 ? argv[index + 1] ?? null : null,
    dryRun: argv.includes("--dry-run"),
    leaveHidden: argv.includes("--leave-hidden"),
  };
}

export function selectedPreviewPacks<T extends { dealerKey: string }>(
  rows: T[],
  dealerKey: string | null,
) {
  return dealerKey ? rows.filter((row) => row.dealerKey === dealerKey) : rows;
}

export function pendingPreviewPacks<T extends { dealerKey: string; materialized: boolean }>(
  rows: T[],
  dealerKey: string | null,
) {
  return selectedPreviewPacks(rows, dealerKey).filter((row) => !row.materialized);
}

export function packNeedsUpload(summary: { create: number; backfill: number; missingImages: number }) {
  return summary.create > 0 || summary.backfill > 0 || summary.missingImages > 0;
}
