import type { uploadPreviewPackImages } from "../../lib/preview-packs/upload";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertWorkerEnabled } from "../../lib/dealer-stock-sync/worker-guard";
import { getDealerListingCap } from "../../lib/config/dealer-tiers";
import { applyFrozenPlan, type ApplyWriter } from "../../lib/dealer-stock-sync/apply";
import { scrapeFailureReason, type SourceCompleteness } from "../../lib/dealer-stock-sync/completeness";
import { dealerSyncBlockReason } from "../../lib/dealer-stock-sync/eligibility";
import { fingerprintSnapshot, type FingerprintSnapshot } from "../../lib/dealer-stock-sync/fingerprint";
import { LEASE_JOB_SQL } from "../../lib/dealer-stock-sync/lease";
import { buildStockSyncPlan } from "../../lib/dealer-stock-sync/plan";
import { persistCompleteScrape, persistFailedScrape } from "../../lib/dealer-stock-sync/persist-report";
import { getDealerStockRegistryOption } from "../../lib/dealer-stock-sync/registry-catalog";
import type { SyncIdentity, SyncListing } from "../../lib/dealer-stock-sync/types";
import { db } from "../../lib/db";
import { getDealer } from "./registry";
import { takeDownManagedListing } from "./take-down";
import { inventoryFromReconciled } from "./to-inventory";
import type { PipelineResult } from "./types";

const LEASE_MS = 15 * 60 * 1000;
const CAP_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;

function safeError(error: unknown) {
  if (error instanceof Error && error.name === "StalePlanError") return error.message;
  return "Stock sync job failed.";
}

function mileageOf(values: Array<{ value: string; attributeDefinition: { slug: string } }>) {
  const raw = values.find((value) => value.attributeDefinition.slug === "mileage")?.value;
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

async function loadSnapshot(
  dealerId: string,
  actions: FingerprintSnapshot["actions"],
  client: Prisma.TransactionClient = db,
): Promise<FingerprintSnapshot | null> {
  const dealer = await client.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      id: true,
      tier: true,
      isAdminPreview: true,
      userId: true,
      stockSourceBinding: {
        select: {
          id: true,
          registryKey: true,
          enabled: true,
          verifiedAt: true,
          identities: true,
        },
      },
      user: { select: { role: true, disabledAt: true, deletedAt: true, regionId: true } },
    },
  });
  if (!dealer?.stockSourceBinding) return null;
  const [listings, activeListingCount] = await Promise.all([
    client.listing.findMany({
      where: { dealerId, retentionPurgedAt: null, previewPackId: null },
      select: {
        id: true,
        updatedAt: true,
        userId: true,
        title: true,
        description: true,
        status: true,
        price: true,
        featured: true,
        expiresAt: true,
        soldAt: true,
        lifecycleRevision: true,
        photoRevision: true,
        reviewSourceIdentity: true,
        slug: true,
        previewPackId: true,
        attributeValues: { select: { value: true, attributeDefinition: { select: { slug: true } } } },
        revisions: { where: { status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } },
      },
    }),
    client.listing.count({
      where: { dealerId, retentionPurgedAt: null, status: { in: [...CAP_STATUSES] } },
    }),
  ]);
  const syncListings: SyncListing[] = listings.map((listing) => ({
    id: listing.id,
    updatedAt: listing.updatedAt.toISOString(),
    userId: listing.userId,
    title: listing.title,
    description: listing.description,
    status: listing.status,
    price: listing.price,
    mileage: mileageOf(listing.attributeValues),
    featured: listing.featured,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    soldAt: listing.soldAt?.toISOString() ?? null,
    lifecycleRevision: listing.lifecycleRevision,
    photoRevision: listing.photoRevision,
    reviewSourceIdentity: listing.reviewSourceIdentity,
    slug: listing.slug,
    previewPackId: listing.previewPackId,
    openRevision: listing.revisions.length > 0,
  }));
  const identities: SyncIdentity[] = dealer.stockSourceBinding.identities.map((identity) => ({
    sourceIdentityKey: identity.sourceIdentityKey,
    listingId: identity.listingId,
    absenceCount: identity.absenceCount,
    lastAbsenceRunId: identity.lastAbsenceRunId,
    lastSeenRunId: identity.lastSeenRunId,
    baselinePricePence: identity.baselinePricePence,
    baselineMileage: identity.baselineMileage,
  }));
  return {
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
    binding: {
      id: dealer.stockSourceBinding.id,
      registryKey: dealer.stockSourceBinding.registryKey,
      enabled: dealer.stockSourceBinding.enabled,
      verifiedAt: dealer.stockSourceBinding.verifiedAt?.toISOString() ?? null,
    },
    activeListingCount,
    listingCap: getDealerListingCap(dealer.tier),
    listings: syncListings,
    identities,
    actions,
  };
}

function completenessFrom(result: PipelineResult): SourceCompleteness[] {
  return result.sourceResults.map((source) => ({
    status: source.status,
    vehicleCount: source.vehicles.length,
    advertisedCount: source.advertisedCount,
    pagesFetched: source.pagesFetched,
    detailMissing: source.detailMissing ?? 1,
    paginationUncertain: source.paginationUncertain !== false,
  }));
}

async function scrapeJob(
  job: LeasedJob,
  scrape: (registryKey: string) => Promise<PipelineResult>,
) {
  const binding = await db.dealerStockSourceBinding.findUnique({
    where: { id: job.bindingId },
    select: {
      registryKey: true,
      verifiedAt: true,
      dealerId: true,
      dealer: {
        select: {
          isAdminPreview: true,
          user: { select: { id: true, role: true, disabledAt: true, deletedAt: true, regionId: true } },
        },
      },
    },
  });
  if (!binding || !binding.verifiedAt || binding.dealerId !== job.dealerId ||
      (job.payload as {registryKey?: string}).registryKey !== binding.registryKey) throw new Error("Binding changed");
  const block = dealerSyncBlockReason({
    isAdminPreview: binding.dealer.isAdminPreview,
    role: binding.dealer.user.role,
    disabledAt: binding.dealer.user.disabledAt,
    deletedAt: binding.dealer.user.deletedAt,
  });
  if (block || !getDealerStockRegistryOption(binding.registryKey)) {
    await withLease(job, (tx) =>
      persistFailedScrape(tx, {
        bindingId: job.bindingId,
        dealerId: job.dealerId,
        scrapeRunId: job.id,
        failureReason: block ?? "unknown-registry",
        jobId: job.id,
      }),
    );
    return;
  }
  const dealer = getDealer(binding.registryKey);
  if (dealer.status !== "confirmed" || !dealer.sources.some((source) => source.startUrl)) {
    await withLease(job, (tx) =>
      persistFailedScrape(tx, {
        bindingId: job.bindingId,
        dealerId: job.dealerId,
        scrapeRunId: job.id,
        failureReason: "registry-not-runnable",
        jobId: job.id,
      }),
    );
    return;
  }
  const result = await scrape(binding.registryKey).catch(() => null);
  if (!result) {
    await withLease(job, tx => persistFailedScrape(tx, { bindingId: job.bindingId, dealerId: job.dealerId,
      scrapeRunId: job.id, jobId: job.id, failureReason: "source-failed" }));
    return;
  }
  const inventory = inventoryFromReconciled(result.reconciled);
  const keys = inventory.map(vehicle => vehicle.sourceIdentityKey);
  const uncertainIdentity = keys.some(key => !key) || new Set(keys).size !== keys.length ||
    result.reconciled.some(vehicle => vehicle.identityConflict);
  const failure = scrapeFailureReason(completenessFrom(result)) ?? (uncertainIdentity ? "identity-uncertain" : null);
  if (failure) {
    await withLease(job, async tx => {
      const seen = keys.filter((key): key is string => Boolean(key));
      await tx.dealerStockSourceIdentity.updateMany({ where: { bindingId: job.bindingId, sourceIdentityKey: { in: seen } },
        data: { absenceCount: 0, lastAbsenceRunId: null, lastSeenRunId: job.id } });
      return persistFailedScrape(tx, { bindingId: job.bindingId, dealerId: job.dealerId,
        scrapeRunId: job.id, failureReason: failure, jobId: job.id });
    });
    return;
  }
  await withLease(job, async (tx) => {
    const current = await loadSnapshot(job.dealerId, [], tx);
    if (!current || current.binding.registryKey !== binding.registryKey || !current.binding.verifiedAt ||
      dealerSyncBlockReason({ ...current.dealer, role: current.dealer.role as "USER" | "DEALER" | "ADMIN" })) throw new Error("Binding changed during check");
    const plan = buildStockSyncPlan({
      scrapeRunId: job.id,
      registryKey: binding.registryKey,
      regionId: current.dealer.regionId,
      vehicles: inventory,
      identities: current.identities,
      listings: current.listings,
    });
    const identities = [...current.identities];
    for (const patch of plan.patches) {
      const index = identities.findIndex((item) => item.sourceIdentityKey === patch.sourceIdentityKey);
      if (index === -1) identities.push(patch);
      else identities[index] = patch;
    }
    await persistCompleteScrape(tx, {
      bindingId: job.bindingId,
      dealerId: job.dealerId,
      scrapeRunId: job.id,
      jobId: job.id,
      patches: plan.patches,
      inventoryCount: plan.inventoryCount,
      snapshot: { ...current, identities, actions: plan.actions.map(action => ({ ...action,
        displayTitle: inventory.find(vehicle => vehicle.sourceIdentityKey === action.sourceIdentityKey)?.title ??
          current.listings.find(listing => listing.id === action.listingId)?.title ?? "Vehicle requiring review",
      })) },
    });
  });
}

type LeasedJob = Awaited<ReturnType<typeof db.dealerStockSyncJob.findUniqueOrThrow>>;

async function withLease<T>(job: LeasedJob, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  assertWorkerEnabled();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${job.bindingId} FOR UPDATE`;
    const binding = await tx.dealerStockSourceBinding.findUnique({ where: { id: job.bindingId } });
    if (!binding || binding.dealerId !== job.dealerId || !binding.verifiedAt ||
      (job.kind === "SCRAPE" && binding.registryKey !== (job.payload as { registryKey?: string }).registryKey)) {
      throw new Error("Source binding changed while the job was running");
    }
    const fence = await tx.dealerStockSyncJob.updateMany({
      where: { id: job.id, status: "LEASED", leaseOwner: job.leaseOwner, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    if (fence.count !== 1) throw new Error("Lease lost");
    await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${job.dealerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "dealerId" = ${job.dealerId} FOR UPDATE`;
    const result = await work(tx);
    await tx.dealerStockSyncJob.update({ where: { id: job.id }, data: {
      status: "SUCCEEDED", finishedAt: new Date(), leaseExpiresAt: null, error: null,
    }});
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

async function applyJob(job: LeasedJob, upload?: typeof uploadPreviewPackImages) {
  if (!job.reportId) throw new Error("Missing report");
  const report = await db.dealerStockSyncReport.findUnique({ where: { id: job.reportId } });
  if (!report?.approvedById || report.status !== "APPROVED" || report.bindingId !== job.bindingId || report.dealerId !== job.dealerId) throw new Error("Missing approval");
  const payload = job.payload as { fingerprint?: string };
  if (payload.fingerprint !== report.fingerprint) throw new Error("Stale stock sync plan");
  const actions = (report.plan as { actions?: FingerprintSnapshot["actions"] }).actions ?? [];
  const snapshot = await loadSnapshot(job.dealerId, actions);
  if (!snapshot || fingerprintSnapshot(snapshot) !== report.fingerprint) throw new Error("Stale stock sync plan");
  const { prepareStockImages, cleanupStockImages } = await import("./stock-images");
  const staged = await prepareStockImages(snapshot, job.id, upload);
  try {
    await withLease(job, async (tx) => {
      const freshReport = await tx.dealerStockSyncReport.findUniqueOrThrow({ where: { id: report.id } });
      const actor = await tx.user.findUnique({ where: { id: report.approvedById! }, select: { role: true, disabledAt: true, deletedAt: true } });
      if (!actor || actor.role !== "ADMIN" || actor.disabledAt || actor.deletedAt) throw new Error("Approver is unavailable");
      const fresh = await loadSnapshot(job.dealerId, actions, tx);
      if (!fresh) throw new Error("Missing snapshot");
      const { claimManagedImportsForAttachment } = await import("../../lib/media/managed-import");
      await claimManagedImportsForAttachment(tx, staged.uploaded);
      await applyFrozenPlan({ client: tx as unknown as ApplyWriter, snapshot: fresh,
        storedFingerprint: report.fingerprint, reportId: report.id, reportStatus: freshReport.status,
        actorId: report.approvedById!, jobId: job.id, now: new Date(), stagedImages: staged.images,
        takeDown: (request) => takeDownManagedListing(tx, request),
      });
    });
  } catch (error) {
    await cleanupStockImages(staged.uploaded);
    throw error;
  }
}

export async function leaseOneJob(owner = randomUUID(), now = new Date()) {
  assertWorkerEnabled();
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(LEASE_JOB_SQL, owner, new Date(now.getTime() + LEASE_MS));
  return rows[0] ? { id: rows[0].id, owner } : null;
}

export async function runLeasedJob(
  lease: { id: string; owner: string },
  scrape: (registryKey: string) => Promise<PipelineResult>,
  upload?: typeof uploadPreviewPackImages,
) {
  assertWorkerEnabled();
  const job = await db.dealerStockSyncJob.findUnique({ where: { id: lease.id } });
  if (!job || job.status !== "LEASED" || job.leaseOwner !== lease.owner || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return;
  const heartbeat = setInterval(() => {
    void db.dealerStockSyncJob.updateMany({ where: {
      id: job.id, status: "LEASED", leaseOwner: lease.owner, leaseExpiresAt: { gt: new Date() },
    }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined);
  }, 60000);
  try {
    if (job.kind === "SCRAPE") await scrapeJob(job, scrape);
    if (job.kind === "APPLY") await applyJob(job, upload);
  } catch (error) {
    await db.dealerStockSyncJob.updateMany({ where: { id: job.id, status: "LEASED", leaseOwner: lease.owner },
      data: { status: "FAILED", finishedAt: new Date(), leaseExpiresAt: null, error: safeError(error) },
    });
  } finally { clearInterval(heartbeat); }
}
