import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AffectedPreviewPackKey,
  PreviewRepairWorkItem,
} from "../../lib/preview-packs/repair-images";

export const PREVIEW_REPAIR_SCHEMA_VERSION = 1;

export interface PreviewRepairPlanPack {
  dealerKey: AffectedPreviewPackKey;
  listingCount: number;
  items: PreviewRepairWorkItem[];
  skipped: Array<{ title: string; reason: string }>;
}

export interface PreviewRepairPlan {
  schemaVersion: typeof PREVIEW_REPAIR_SCHEMA_VERSION;
  runId: string;
  dealers: AffectedPreviewPackKey[];
  packs: PreviewRepairPlanPack[];
  planCount: number;
  planFingerprint: string;
}

function fingerprintPayload(plan: Omit<PreviewRepairPlan, "planFingerprint">) {
  return {
    schemaVersion: plan.schemaVersion,
    runId: plan.runId,
    dealers: plan.dealers,
    packs: plan.packs.map((pack) => ({
      dealerKey: pack.dealerKey,
      listingCount: pack.listingCount,
      items: pack.items.map((item) => ({
        listingId: item.listingId,
        identityKey: item.identityKey,
        dealerKey: item.dealerKey,
        previewPackId: item.previewPackId,
        dealerId: item.dealerId,
        sourceRunId: item.sourceRunId,
        expectedPhotoRevision: item.expectedPhotoRevision,
        oldPublicIds: item.oldPublicIds,
        sources: item.sources,
      })),
      skipped: pack.skipped,
    })),
    planCount: plan.planCount,
  };
}

export function previewRepairPlanFingerprint(
  plan: Omit<PreviewRepairPlan, "planFingerprint">,
) {
  return createHash("sha256")
    .update(JSON.stringify(fingerprintPayload(plan)))
    .digest("hex");
}

export function buildPreviewRepairPlan(input: {
  runId: string;
  dealers: AffectedPreviewPackKey[];
  packs: PreviewRepairPlanPack[];
}): PreviewRepairPlan {
  for (const pack of input.packs) {
    if (pack.items.some((item) => item.dealerKey !== pack.dealerKey)) {
      throw new Error("Refusing preview pack image repair: item dealer does not match its pack.");
    }
  }
  const plan: Omit<PreviewRepairPlan, "planFingerprint"> = {
    schemaVersion: PREVIEW_REPAIR_SCHEMA_VERSION,
    runId: input.runId,
    dealers: input.dealers,
    packs: input.packs,
    planCount: input.packs.reduce((sum, pack) => sum + pack.items.length, 0),
  };
  return { ...plan, planFingerprint: previewRepairPlanFingerprint(plan) };
}

function planPath(runId: string, cwd = process.cwd()) {
  return resolve(cwd, "private", "preview-pack-image-repair", runId, "plan.json");
}

export function writePreviewRepairPlan(plan: PreviewRepairPlan, cwd = process.cwd()) {
  const path = planPath(plan.runId, cwd);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}

export function readPreviewRepairPlan(runId: string, cwd = process.cwd()) {
  const parsed = JSON.parse(readFileSync(planPath(runId, cwd), "utf8")) as PreviewRepairPlan;
  if (
    parsed.schemaVersion !== PREVIEW_REPAIR_SCHEMA_VERSION ||
    parsed.runId !== runId ||
    parsed.planCount !== parsed.packs.reduce((sum, pack) => sum + pack.items.length, 0) ||
    parsed.packs.some((pack) =>
      pack.items.some((item) => item.dealerKey !== pack.dealerKey),
    ) ||
    parsed.planFingerprint !== previewRepairPlanFingerprint({
      schemaVersion: parsed.schemaVersion,
      runId: parsed.runId,
      dealers: parsed.dealers,
      packs: parsed.packs,
      planCount: parsed.planCount,
    })
  ) {
    throw new Error("Refusing preview pack image repair: frozen plan is invalid.");
  }
  return parsed;
}

export function assertPreviewRepairPlanBinding(input: {
  plan: PreviewRepairPlan;
  snapshot: string;
  planFingerprint: string;
  planCount: string;
  dealers: AffectedPreviewPackKey[];
}) {
  if (
    input.snapshot !== input.plan.runId ||
    input.planFingerprint !== input.plan.planFingerprint ||
    Number(input.planCount) !== input.plan.planCount ||
    JSON.stringify(input.dealers) !== JSON.stringify(input.plan.dealers)
  ) {
    throw new Error("Refusing preview pack image repair: apply flags do not match the frozen plan.");
  }
}
