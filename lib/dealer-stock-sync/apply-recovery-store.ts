import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dealerSyncBlockReason } from "./eligibility";
import { fingerprintSnapshot } from "./fingerprint";
import { loadStockSyncSnapshot } from "./snapshot";
import { readPlanActions } from "./review-edit";
import { getDealerStockRegistryOption } from "./registry-catalog";
import { enqueueScrapeJob } from "./enqueue";
import { applyRecoveryState, matchesApprovedAttempt, type RecoveryReport, type StockRecoveryInput } from "./apply-recovery";

const latestOrder = [{ createdAt: "desc" }, { id: "desc" }] as const;
const activeWhere = { status: { in: ["QUEUED", "LEASED"] as Array<"QUEUED" | "LEASED"> } };
const FRESH = "Stock or approval has changed. Run a fresh check, then review and approve the new results.";
const CONFLICT = "This apply attempt changed. Refresh the results before retrying.";

// These reads deliberately do not use history audits or the recent-jobs limit.
export async function decorateStockApplyRecovery<T extends RecoveryReport>(reports: T[]) {
  const approved = reports.filter(report => report.status === "APPROVED");
  if (!approved.length) return reports.map(report => ({ ...report, applyRecovery: null }));
  const [attempts, activeJobs] = await Promise.all([
    db.dealerStockSyncJob.findMany({
      where: { reportId: { in: approved.map(report => report.id) }, kind: "APPLY" },
      orderBy: [...latestOrder], distinct: ["reportId"],
      select: { id: true, kind: true, status: true, reportId: true, dealerId: true, bindingId: true, payload: true },
    }),
    db.dealerStockSyncJob.findMany({
      where: { bindingId: { in: [...new Set(approved.map(report => report.bindingId))] }, ...activeWhere },
      orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, bindingId: true },
    }),
  ]);
  const byReport = new Map(attempts.map(attempt => [attempt.reportId, attempt]));
  return reports.map(report => ({
    ...report,
    applyRecovery: report.status === "APPROVED" ? applyRecoveryState(report, byReport.get(report.id) ?? null,
      activeJobs.find(job => job.bindingId === report.bindingId) ?? null) : null,
  }));
}

async function recoverUnderLock(tx: Prisma.TransactionClient, input: StockRecoveryInput, actorId: string) {
  const initial = await tx.dealerStockSyncReport.findUnique({ where: { id: input.reportId }, select: { bindingId: true } });
  if (!initial) return { error: CONFLICT };
  await tx.$queryRaw`SELECT "id" FROM "DealerStockSourceBinding" WHERE "id" = ${initial.bindingId} FOR UPDATE`;
  const report = await tx.dealerStockSyncReport.findUnique({ where: { id: input.reportId } });
  if (!report || report.bindingId !== initial.bindingId || report.status !== "APPROVED" || report.fingerprint !== input.fingerprint) return { error: CONFLICT };
  const binding = await tx.dealerStockSourceBinding.findUnique({ where: { id: report.bindingId }, include: { dealer: { include: { user: true } } } });
  if (!binding || binding.dealerId !== report.dealerId || !binding.verifiedAt || !getDealerStockRegistryOption(binding.registryKey) ||
    dealerSyncBlockReason({ ...binding.dealer, ...binding.dealer.user })) return { error: "This dealer or verified website source is unavailable. Check its settings before running a fresh check." };
  const active = await tx.dealerStockSyncJob.findFirst({ where: { bindingId: report.bindingId, ...activeWhere } });
  if (active) {
    if (input.operation === "retry" && active.idempotencyKey === `apply-retry:${input.expectedJobId}` && matchesApprovedAttempt(report, active)) {
      return { data: { jobId: active.id, dealerId: report.dealerId, status: "exists" as const } };
    }
    return { error: "Wait for this dealer's current stock task to finish before recovering the review." };
  }
  if (input.operation === "fresh") {
    const queued = await enqueueScrapeJob(tx, { binding: { ...binding, dealer: { ...binding.dealer, ...binding.dealer.user } }, mode: "ondemand", now: new Date(), createdById: actorId });
    if (queued.status === "skipped" || !queued.jobId) return { error: "The fresh check could not be queued. Refresh and try again." };
    await audit(tx, report.id, actorId, queued.jobId, "fresh-check", report.fingerprint);
    return { data: { jobId: queued.jobId, dealerId: report.dealerId, status: queued.status } };
  }
  const previous = await tx.dealerStockSyncJob.findFirst({ where: { reportId: report.id, kind: "APPLY" }, orderBy: [...latestOrder] });
  if (!previous || previous.id !== input.expectedJobId || !applyRecoveryState(report, previous, null).retryable) return { error: CONFLICT + " Run a fresh check if no valid failed attempt is available." };
  if (!report.approvedAt || !report.approvedById) return { error: FRESH };
  const approver = await tx.user.findUnique({ where: { id: report.approvedById }, select: { role: true, disabledAt: true, deletedAt: true } });
  if (!approver || approver.role !== "ADMIN" || approver.disabledAt || approver.deletedAt) return { error: FRESH };
  await tx.$queryRaw`SELECT "id" FROM "DealerProfile" WHERE "id" = ${report.dealerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "dealerId" = ${report.dealerId} FOR UPDATE`;
  const actions = readPlanActions(report.plan);
  if (!actions?.length) return { error: FRESH };
  const snapshot = await loadStockSyncSnapshot(report.dealerId, actions, tx);
  if (!snapshot || snapshot.binding.id !== report.bindingId || snapshot.dealer.id !== report.dealerId ||
    fingerprintSnapshot(snapshot) !== report.fingerprint) return { error: FRESH };
  const job = await tx.dealerStockSyncJob.create({ data: {
    kind: "APPLY", status: "QUEUED", bindingId: report.bindingId, dealerId: report.dealerId, reportId: report.id,
    idempotencyKey: `apply-retry:${previous.id}`,
    // A failed desktop attempt may contain receipts for media already cleaned up.
    payload: { reportId: report.id, fingerprint: report.fingerprint }, createdById: actorId,
  }, select: { id: true } });
  await audit(tx, report.id, actorId, job.id, "retry-apply", report.fingerprint, previous.id);
  return { data: { jobId: job.id, dealerId: report.dealerId, status: "queued" as const } };
}

async function audit(tx: Prisma.TransactionClient, reportId: string, actorId: string, jobId: string, action: string, fingerprint: string, previousJobId?: string) {
  await tx.dealerStockSyncAudit.create({ data: {
    reportId, actorId, jobId, action: `review-recovery-${action}`,
    before: { fingerprint, previousJobId: previousJobId ?? null }, after: { jobId },
  } });
}

export async function recoverApprovedStock(input: StockRecoveryInput, actorId: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(tx => recoverUnderLock(tx, input, actorId), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && attempt < 2) {
        const target = error.meta?.target;
        const retryKeyCollision = input.operation === "retry" && error.code === "P2002" &&
          (Array.isArray(target) ? target.length === 1 && target[0] === "idempotencyKey" :
            target === "idempotencyKey" || target === "DealerStockSyncJob_idempotencyKey_key");
        if (error.code === "P2034" || retryKeyCollision) continue;
      }
      throw error;
    }
  }
}
