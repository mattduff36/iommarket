import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDealerListingCap } from "../../lib/config/dealer-tiers";
import { getDealerStockSyncAvailability } from "../../lib/deployment/dealer-stock-sync";
import { dealerSyncBlockReason } from "../../lib/dealer-stock-sync/eligibility";
import type { FingerprintSnapshot } from "../../lib/dealer-stock-sync/fingerprint";
import { buildStockSyncPlan } from "../../lib/dealer-stock-sync/plan";
import { persistCompleteScrape } from "../../lib/dealer-stock-sync/persist-report";
import { getDealerStockRegistryOption } from "../../lib/dealer-stock-sync/registry-catalog";
import type { IdentityPatch, PlanAction, SyncIdentity, SyncListing } from "../../lib/dealer-stock-sync/types";
import { getDealer } from "../dealer-stock-sync/registry";
import {
  adaptReviewedSource,
  assertExpectedSha256,
  withReviewEvidence,
  type ReviewedAdaptation,
} from "../dealer-stock-sync/reviewed-source";

const PRODUCTION_REF = "snlqivvogfqesxpbjiei";
const PREVIEW_REF = "syneonzucehwlghqmfbg";
const CAP_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;
const ARCHIVES: Record<string, string> = {
  "skillannaylor-car-company": "private/dealer-stock-archive/runs/2026-10-21-sn-five-pages/skillannaylor-car-company/vehicles.json",
  "dw-cars": "private/dealer-stock-archive/runs/2026-10-21T08-35-36-421Z/dw-cars/vehicles.json",
};
const REVIEWED_FILES: Record<string, string> = {
  "skillannaylor-car-company": "sn-source-reviewed.json",
  "dw-cars": "dw-source-reviewed.json",
};

const manifestSchema = z.object({
  sourceEvidenceRoot: z.string().min(1),
  sourceSnapshots: z.array(z.object({
    file: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
  accounts: z.array(z.object({ dealerId: z.string().min(1).max(64), key: z.string().min(1) }).passthrough()),
});

interface SeedClient {
  user: { findUnique(args: { where: object; select?: object }): Promise<{ id: string; role: string; disabledAt: Date | null; deletedAt: Date | null } | null> };
  dealerProfile: { findUnique(args: { where: object; select?: object; include?: object }): Promise<{
    id: string; tier: string; isAdminPreview: boolean; userId: string;
    user: { role: "USER" | "DEALER" | "ADMIN"; disabledAt: Date | null; deletedAt: Date | null; regionId: string | null };
  } | null> };
  listing: { count(args: { where: object }): Promise<number> };
  dealerStockSourceBinding: {
    findUnique(args: { where: object }): Promise<{ id: string; dealerId: string; registryKey: string; enabled: boolean; verifiedAt: Date | string | null } | null>;
    create(args: { data: object }): Promise<{ id: string; registryKey: string; enabled: boolean; verifiedAt: Date | null }>;
  };
  dealerStockSourceIdentity: { count(args: { where: object }): Promise<number>; upsert(args: object): Promise<{ id: string }> };
  dealerStockSyncJob: { count(args: { where: object }): Promise<number>; create(args: { data: object }): Promise<{ id: string }> };
  dealerStockSyncReport: {
    findMany(args: object): Promise<Array<{ id: string; plan: unknown }>>;
    updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
    create(args: { data: object }): Promise<{ id: string; fingerprint: string }>;
    update(args: { where: object; data: object }): Promise<unknown>;
  };
  dealerStockSyncAudit: { create(args: { data: object }): Promise<{ id: string }> };
  $transaction<T>(work: (tx: SeedClient) => Promise<T>, options?: object): Promise<T>;
}

export interface ReviewedSeedRequest {
  targetConfirmed: true;
  actorId: string;
  dealerId: string;
  registryKey: string;
  sourceHash: string;
  adaptation: ReviewedAdaptation;
}

export function reviewedSeedApplyBlock(env: Record<string, string | undefined>) {
  const material = [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_SUPABASE_URL, env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL, env.DEALER_STOCK_SYNC_TARGET, env.VERCEL_ENV].join(" ");
  if (material.includes(PRODUCTION_REF) || env.DEALER_STOCK_SYNC_TARGET === "production" || env.VERCEL_ENV === "production") {
    return "Reviewed stock seed cannot target production.";
  }
  if (env.DEALER_STOCK_SYNC_TARGET !== "preview") return "Apply requires the explicit preview target.";
  const availability = getDealerStockSyncAvailability(env);
  if (!availability.enabled || availability.environment !== "preview" || !env.NEXT_PUBLIC_SUPABASE_URL?.includes(PREVIEW_REF)) {
    return availability.reason ?? "Preview authentication and database project were not verified.";
  }
  return null;
}

export function reviewedCapacityWarning(input: {
  regionId: string | null;
  activeListingCount: number;
  listingCap: number;
  createCount: number;
}) {
  if (!input.regionId) return "A dealer region is required before new stock can be added.";
  if (input.activeListingCount + input.createCount > input.listingCap) {
    return `This review proposes ${input.createCount} additions and the dealer already has ${input.activeListingCount} of ${input.listingCap} active listings.`;
  }
  return null;
}

export function identitiesAfterPatches(current: SyncIdentity[], patches: IdentityPatch[]) {
  const identities = [...current];
  for (const patch of patches) {
    const index = identities.findIndex((item) => item.sourceIdentityKey === patch.sourceIdentityKey);
    if (index === -1) identities.push(patch);
    else identities[index] = patch;
  }
  return identities;
}

function assertAdditionsOnly(actions: PlanAction[]) {
  const removal = actions.some((action) =>
    action.kind === "missing_once" || action.kind === "unpublish" || action.kind === "update" ||
    (action.kind === "blocked" && action.section === "missing"));
  if (removal) throw new Error("Reviewed seed cannot update, remove, or mark existing stock absent.");
}

export function planReviewedAdditions(input: {
  registryKey: string;
  scrapeRunId: string;
  regionId: string | null;
  listings: SyncListing[];
  identities: SyncIdentity[];
  adaptation: ReviewedAdaptation;
  activeListingCount: number;
  listingCap: number;
}) {
  const plan = buildStockSyncPlan({
    scrapeRunId: input.scrapeRunId,
    registryKey: input.registryKey,
    regionId: input.regionId,
    vehicles: input.adaptation.vehicles,
    identities: input.identities,
    listings: input.listings,
  });
  assertAdditionsOnly(plan.actions);
  const createCount = plan.actions.filter((action) => action.kind === "create").length;
  const capacityWarning = reviewedCapacityWarning({
    regionId: input.regionId,
    activeListingCount: input.activeListingCount,
    listingCap: input.listingCap,
    createCount,
  });
  const actions = withReviewEvidence(plan.actions, input.adaptation.evidence, capacityWarning);
  return {
    actions,
    patches: plan.patches,
    inventoryCount: plan.inventoryCount,
    identities: identitiesAfterPatches(input.identities, plan.patches),
    capacityWarning,
    createCount,
  };
}

function storedHash(plan: unknown) {
  if (!plan || typeof plan !== "object" || !("reviewSource" in plan)) return null;
  const hash = (plan as { reviewSource?: { sourceHash?: unknown } }).reviewSource?.sourceHash;
  return typeof hash === "string" ? hash : null;
}

async function existingReview(client: SeedClient, dealerId: string, sourceHash: string) {
  const reports = await client.dealerStockSyncReport.findMany({
    where: { dealerId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
  });
  if (reports.length === 0) return null;
  if (reports.every((report) => storedHash(report.plan) === sourceHash)) {
    return { outcome: "existing" as const, reportId: reports[0]?.id ?? "", wrote: false as const };
  }
  throw new Error("An active stock review already exists for a different source snapshot.");
}

export async function applyReviewedDealerSeed(client: SeedClient, input: ReviewedSeedRequest) {
  if (input.targetConfirmed !== true) throw new Error("Preview target was not confirmed.");
  if (!getDealerStockRegistryOption(input.registryKey) || getDealer(input.registryKey).status !== "confirmed") {
    throw new Error("The registry source is not confirmed.");
  }
  return client.$transaction(async (tx) => {
  const existing = await existingReview(tx, input.dealerId, input.sourceHash);
  if (existing) return { ...existing, dealerId: input.dealerId, registryKey: input.registryKey };
  const actor = await tx.user.findUnique({ where: { id: input.actorId } });
  if (!actor || actor.role !== "ADMIN" || actor.disabledAt || actor.deletedAt) throw new Error("An active admin actor is required.");
  const dealer = await tx.dealerProfile.findUnique({ where: { id: input.dealerId }, include: { user: true } });
  if (!dealer) throw new Error("Dealer was not found.");
  const eligibility = dealerSyncBlockReason({
    isAdminPreview: dealer.isAdminPreview,
    role: dealer.user.role,
    disabledAt: dealer.user.disabledAt,
    deletedAt: dealer.user.deletedAt,
  });
  if (eligibility) throw new Error(`Dealer is not eligible for stock review (${eligibility}).`);
  if (await tx.listing.count({ where: { dealerId: input.dealerId, retentionPurgedAt: null } }) !== 0) {
    throw new Error("Reviewed seed requires no existing listings.");
  }
  if (await tx.dealerStockSourceIdentity.count({ where: { dealerId: input.dealerId } }) !== 0) {
    throw new Error("Reviewed seed requires zero existing stock identities.");
  }
  if (await tx.dealerStockSyncJob.count({ where: { dealerId: input.dealerId, status: { in: ["QUEUED", "LEASED"] } } }) !== 0) {
    throw new Error("A queued or leased stock job already exists.");
  }
  if (await tx.dealerStockSyncJob.count({ where: { dealerId: input.dealerId, kind: "APPLY" } }) !== 0) {
    throw new Error("An apply job already exists.");
  }
  const binding = await tx.dealerStockSourceBinding.findUnique({ where: { dealerId: input.dealerId } });
  if (binding && (binding.registryKey !== input.registryKey || binding.enabled || !binding.verifiedAt)) {
    throw new Error("The dealer source binding must already be verified, disabled, and match this registry key.");
  }
  if (!binding && await tx.dealerStockSourceBinding.findUnique({ where: { registryKey: input.registryKey } })) {
    throw new Error("This registry key is already bound.");
  }
  const activeListingCount = await tx.listing.count({
    where: { dealerId: input.dealerId, retentionPurgedAt: null, status: { in: [...CAP_STATUSES] } },
  });
    const currentBinding = binding ?? await tx.dealerStockSourceBinding.create({
      data: {
        dealerId: input.dealerId,
        registryKey: input.registryKey,
        enabled: false,
        verifiedAt: new Date(),
        verifiedById: input.actorId,
      },
    });
    const verifiedAt = currentBinding.verifiedAt instanceof Date ? currentBinding.verifiedAt.toISOString() : currentBinding.verifiedAt;
    const planned = planReviewedAdditions({
      registryKey: input.registryKey,
      scrapeRunId: `reviewed-${input.sourceHash.slice(0, 16)}`,
      regionId: dealer.user.regionId,
      listings: [],
      identities: [],
      adaptation: input.adaptation,
      activeListingCount,
      listingCap: getDealerListingCap(dealer.tier as "STARTER" | "PRO"),
    });
    const snapshot: FingerprintSnapshot = {
      dealer: {
        id: dealer.id,
        userId: dealer.userId,
        regionId: dealer.user.regionId,
        tier: dealer.tier,
        isAdminPreview: dealer.isAdminPreview,
        role: dealer.user.role,
        disabledAt: dealer.user.disabledAt?.toISOString() ?? null,
        deletedAt: dealer.user.deletedAt?.toISOString() ?? null,
      },
      binding: { id: currentBinding.id, registryKey: input.registryKey, enabled: false, verifiedAt },
      activeListingCount,
      listingCap: getDealerListingCap(dealer.tier as "STARTER" | "PRO"),
      listings: [],
      identities: planned.identities,
      actions: planned.actions,
    };
    const job = await tx.dealerStockSyncJob.create({
      data: {
        kind: "SCRAPE",
        status: "SUCCEEDED",
        bindingId: currentBinding.id,
        dealerId: input.dealerId,
        idempotencyKey: `reviewed-seed:${input.registryKey}:${input.sourceHash}`,
        payload: { source: "reviewed-seed", sourceHash: input.sourceHash },
        createdById: input.actorId,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    const saved = await persistCompleteScrape(tx, {
      bindingId: currentBinding.id,
      dealerId: input.dealerId,
      scrapeRunId: `reviewed-${input.sourceHash.slice(0, 16)}`,
      jobId: job.id,
      patches: planned.patches,
      inventoryCount: planned.inventoryCount,
      snapshot,
    });
    await tx.dealerStockSyncReport.update({
      where: { id: saved.report.id },
      data: {
        plan: {
          actions: planned.actions,
          reviewSource: {
            sourceHash: input.sourceHash,
            capturedAt: input.adaptation.capturedAt,
            registryKey: input.registryKey,
            coverageWarning: input.adaptation.coverageWarning,
            capacityWarning: planned.capacityWarning,
            counts: input.adaptation.counts,
          },
        },
      },
    });
    return {
      outcome: "applied" as const,
      wrote: true as const,
      dealerId: input.dealerId,
      registryKey: input.registryKey,
      reportId: saved.report.id,
      fingerprint: saved.fingerprint,
      counts: { ...input.adaptation.counts, creates: planned.createCount },
      capacityWarning: planned.capacityWarning,
      coverageWarning: input.adaptation.coverageWarning,
    };
  }, { isolationLevel: "Serializable", timeout: 60000 });
}

export function loadBundle(root = process.cwd()) {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(root, "private/dealer-onboarding-20261021/approval-manifest.json"), "utf8")));
  return manifest.accounts.map((account) => {
    const fileName = REVIEWED_FILES[account.key];
    const archivePath = ARCHIVES[account.key];
    const expected = manifest.sourceSnapshots.find((snapshot) => snapshot.file === fileName);
    if (!fileName || !archivePath || !expected) throw new Error(`No reviewed archive is configured for ${account.key}.`);
    const bytes = readFileSync(path.join(root, "private/dealer-onboarding-20261021", fileName));
    assertExpectedSha256(bytes, expected.sha256);
    const adaptation = adaptReviewedSource({
      registryKey: account.key,
      reviewed: JSON.parse(bytes.toString("utf8")),
      archive: JSON.parse(readFileSync(path.join(root, archivePath), "utf8")),
      sourceHash: expected.sha256,
    });
    return { dealerId: account.dealerId, registryKey: account.key, sourceHash: expected.sha256, adaptation };
  });
}

async function main() {
  const bundle = loadBundle();
  if (!process.argv.includes("--apply")) {
    process.stdout.write(`${JSON.stringify({
      mode: "dry-run",
      databaseChecked: false,
      dealers: bundle.map((item) => ({
        dealerId: item.dealerId,
        registryKey: item.registryKey,
        sourceHash: item.sourceHash,
        capturedAt: item.adaptation.capturedAt,
        coverageWarning: item.adaptation.coverageWarning,
        counts: item.adaptation.counts,
      })),
    }, null, 2)}\n`);
    return;
  }
  const block = reviewedSeedApplyBlock(process.env);
  if (block) throw new Error(block);
  const actorFlag = process.argv.indexOf("--actor");
  const actorId = actorFlag === -1 ? "" : process.argv[actorFlag + 1] ?? "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(actorId)) throw new Error("Apply requires an admin user id.");
  const { db } = await import("../../lib/db");
  try {
  for (const item of bundle) {
    const receipt = await applyReviewedDealerSeed(db as unknown as SeedClient, {
      targetConfirmed: true,
      actorId,
      ...item,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  } finally {
    await db.$disconnect();
  }
}

const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (entry.endsWith("scripts/dealer-onboarding/seed-reviewed-stock-reports.ts")) void main();
