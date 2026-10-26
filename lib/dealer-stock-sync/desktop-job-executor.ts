import { db } from "@/lib/db";
import { assertDealerStockSyncEnvironment } from "@/lib/deployment/dealer-stock-sync";
import type {
  DesktopBindingRecord,
  DesktopFailScrapeInput,
  DesktopJobDependencies,
  DesktopJobRecord,
  DesktopReportRecord,
} from "@/lib/dealer-stock-sync/desktop-jobs";
import { defaultJobRandomBytes } from "@/lib/dealer-stock-sync/desktop-jobs";
import { authoriseDesktopRequest, liveDesktopDependencies } from "@/lib/dealer-stock-sync/desktop-service";
import { persistFailedScrape } from "@/lib/dealer-stock-sync/persist-report";
import { runDesktopApplyStep } from "@/lib/dealer-stock-sync/desktop-apply-step";
import { assertManagedUploadsConfigured } from "@/lib/media/direct-upload-token";
import { leaseOneJob, runLeasedJob } from "@/scripts/dealer-stock-sync/execute-job";

const SAFE_FAILURE = "Stock sync job failed.";

async function findJob(id: string): Promise<DesktopJobRecord | null> {
  const job = await db.dealerStockSyncJob.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      bindingId: true,
      dealerId: true,
      reportId: true,
      leaseOwner: true,
      leaseExpiresAt: true,
      payload: true,
    },
  });
  if (!job || (job.kind !== "SCRAPE" && job.kind !== "APPLY")) return null;
  return job;
}

async function findBinding(id: string): Promise<DesktopBindingRecord | null> {
  return db.dealerStockSourceBinding.findUnique({
    where: { id },
    select: { id: true, dealerId: true, registryKey: true, verifiedAt: true },
  });
}

async function findReport(id: string): Promise<DesktopReportRecord | null> {
  return db.dealerStockSyncReport.findUnique({
    where: { id },
    select: { id: true, bindingId: true, dealerId: true, fingerprint: true, status: true, approvedById: true },
  });
}

async function databaseReady(): Promise<boolean> {
  assertManagedUploadsConfigured();
  const rows = await db.$queryRaw<Array<{ ready: number }>>`SELECT 1 AS ready`;
  return Array.isArray(rows) && rows.length === 1;
}

async function failLeasedScrape(input: DesktopFailScrapeInput): Promise<"failed" | "lost"> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${input.bindingId} FOR UPDATE`;
      const binding = await tx.dealerStockSourceBinding.findUnique({ where: { id: input.bindingId } });
      if (!binding || binding.id !== input.bindingId || binding.dealerId !== input.dealerId ||
          binding.registryKey !== input.registryKey || !binding.verifiedAt) return "lost";
      const fence = await tx.dealerStockSyncJob.updateMany({
        where: {
          id: input.jobId,
          status: "LEASED",
          leaseOwner: input.busyOwner,
          leaseExpiresAt: { gt: new Date() },
        },
        data: { leaseExpiresAt: input.expiresAt },
      });
      if (fence.count !== 1) return "lost";
      await persistFailedScrape(tx, {
        bindingId: input.bindingId,
        dealerId: input.dealerId,
        scrapeRunId: input.jobId,
        failureReason: input.failureReason,
        jobId: input.jobId,
      });
      const done = await tx.dealerStockSyncJob.updateMany({
        where: { id: input.jobId, status: "LEASED", leaseOwner: input.busyOwner },
        data: { status: "FAILED", finishedAt: new Date(), leaseExpiresAt: null, error: SAFE_FAILURE },
      });
      if (done.count !== 1) throw new Error(SAFE_FAILURE);
      return "failed";
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch {
    throw new Error(SAFE_FAILURE);
  }
}

/** Production adapter. The closed-over guard is supplied by the jobs service per request. */
export function createDesktopJobDependencies(
  env: Record<string, string | undefined> = process.env,
): DesktopJobDependencies {
  const desktop = liveDesktopDependencies(env);
  return {
    env,
    now: () => new Date(),
    authorize: async (authorization) => {
      const auth = await authoriseDesktopRequest(desktop, authorization);
      if (auth.ok) return auth;
      return { ok: false, status: auth.status, error: auth.error === "invalid_grant" ? "unauthorized" : auth.error };
    },
    assertEnvironment: (current) => {
      const environment = assertDealerStockSyncEnvironment(current);
      if (!environment) throw new Error(SAFE_FAILURE);
      return environment;
    },
    consumeRate: (bucket, limit, windowSeconds) => desktop.store.consumeRate(bucket, limit, windowSeconds),
    randomBytes: defaultJobRandomBytes,
    leaseOneJob: (owner, now, guard) => leaseOneJob(owner, now, guard),
    runLeasedJob: (lease, scrape, _upload, guard) => runLeasedJob(lease, scrape, undefined, guard),
    jobs: {
      findById: findJob,
      async updateMany(args) {
        const updated = await db.dealerStockSyncJob.updateMany(args);
        return { count: updated.count };
      },
    },
    bindings: { findById: findBinding },
    reports: { findById: findReport },
    readiness: databaseReady,
    failScrape: failLeasedScrape,
    applyStep: runDesktopApplyStep,
  };
}
