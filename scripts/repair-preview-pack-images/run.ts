import type { PrismaClient } from "@prisma/client";
import { OCEAN_DEALER_KEY } from "../../lib/preview-packs/safety";
import {
  archivePreviewRepairVehicles,
  loadPreviewPackListings,
  matchArchivePreviewRepairItems,
  matchOceanPreviewRepairItems,
  uploadAndSwapPreviewRepairItem,
  type AffectedPreviewPackKey,
  type PreviewRepairWorkItem,
} from "../../lib/preview-packs/repair-images";
import { mapWithConcurrency } from "../../lib/preview-packs/concurrency";
import { PREVIEW_PACK_VEHICLE_CONCURRENCY } from "../../lib/preview-packs/limits";
import type { RepairVehicle } from "../ocean-inventory/repair-source";
import type { PreviewPackRepairArgs } from "./safety";
import { selectedPreviewRepairDealers } from "./safety";
import {
  assertPreviewRepairPlanBinding,
  buildPreviewRepairPlan,
  readPreviewRepairPlan,
  writePreviewRepairPlan,
  type PreviewRepairPlanPack,
} from "./plan";

export interface PreviewPackRepairReport {
  dryRun: boolean;
  runId: string;
  planFingerprint: string;
  planCount: number;
  packs: Array<{
    dealerKey: string;
    listingCount: number;
    planned: number;
    repaired: number;
    skipped: Array<{ title: string; reason: string }>;
  }>;
}

export async function planPreviewPackRepair(input: {
  prisma: PrismaClient;
  dealerKey: AffectedPreviewPackKey;
  oceanVehicles?: RepairVehicle[];
}) {
  const { pack, listings } = await loadPreviewPackListings(input.prisma, input.dealerKey);
  if (input.dealerKey === OCEAN_DEALER_KEY) {
    if (!input.oceanVehicles) throw new Error("Ocean preview repair requires scraped vehicles.");
    const planned = matchOceanPreviewRepairItems({ listings, vehicles: input.oceanVehicles });
    return {
      pack,
      listings,
      ...planned,
      items: planned.items.map((item) => ({
        ...item,
        previewPackId: pack.id,
        dealerId: pack.dealerProfileId,
        dealerKey: input.dealerKey,
        sourceRunId: pack.sourceRunId,
      })),
    };
  }
  const archive = await archivePreviewRepairVehicles(input.dealerKey);
  const planned = matchArchivePreviewRepairItems({
    dealerKey: input.dealerKey,
    vehicles: archive.vehicles,
    listings,
  });
  return {
    pack,
    listings,
    ...planned,
    items: planned.items.map((item) => ({
      ...item,
      previewPackId: pack.id,
      dealerId: pack.dealerProfileId,
      dealerKey: input.dealerKey,
      sourceRunId: pack.sourceRunId,
    })),
  };
}

export async function runPreviewPackImageRepair(input: {
  args: PreviewPackRepairArgs;
  prisma: PrismaClient;
  scrapeOceanVehicles?: () => Promise<RepairVehicle[]>;
  applyItem?: typeof uploadAndSwapPreviewRepairItem;
  cwd?: string;
}) {
  const dealers = selectedPreviewRepairDealers(input.args);
  let plan;
  if (input.args.apply) {
    plan = readPreviewRepairPlan(input.args.snapshot!, input.cwd);
    assertPreviewRepairPlanBinding({
      plan,
      snapshot: input.args.snapshot!,
      planFingerprint: input.args.planFingerprint!,
      planCount: input.args.planCount!,
      dealers,
    });
  } else {
    let oceanVehicles: RepairVehicle[] | undefined;
    if (dealers.includes(OCEAN_DEALER_KEY)) {
      if (!input.scrapeOceanVehicles) {
        throw new Error("Ocean preview repair requires a scrape function.");
      }
      oceanVehicles = await input.scrapeOceanVehicles();
    }
    const plannedPacks: PreviewRepairPlanPack[] = [];
    for (const dealerKey of dealers) {
      const planned = await planPreviewPackRepair({
        prisma: input.prisma,
        dealerKey,
        oceanVehicles,
      });
      plannedPacks.push({
        dealerKey,
        listingCount: planned.listings.length,
        items: planned.items,
        skipped: planned.skipped,
      });
    }
    plan = buildPreviewRepairPlan({
      runId: new Date().toISOString().replace(/[:.]/g, "-"),
      dealers,
      packs: plannedPacks,
    });
    writePreviewRepairPlan(plan, input.cwd);
  }

  const applyItem = input.applyItem ?? uploadAndSwapPreviewRepairItem;
  const packs: PreviewPackRepairReport["packs"] = [];
  for (const planned of plan.packs) {
    const dealerKey = planned.dealerKey;
    const skipped = [...planned.skipped];
    let repaired = 0;
    if (!input.args.dryRun) {
      const outcomes = await mapWithConcurrency(
        planned.items,
        PREVIEW_PACK_VEHICLE_CONCURRENCY,
        async (item: PreviewRepairWorkItem) =>
          applyItem({
            prisma: input.prisma,
            dealerKey,
            item,
            reason: `preview-pack-image-repair:${dealerKey}`,
          }),
      );
      for (const outcome of outcomes) {
        if (outcome.repaired) repaired += 1;
        else skipped.push({ title: outcome.title, reason: outcome.reason ?? "upload-empty" });
      }
    }
    packs.push({
      dealerKey,
      listingCount: planned.listingCount,
      planned: planned.items.length,
      repaired: input.args.dryRun ? 0 : repaired,
      skipped,
    });
  }
  return {
    dryRun: input.args.dryRun,
    runId: plan.runId,
    planFingerprint: plan.planFingerprint,
    planCount: plan.planCount,
    packs,
  };
}
