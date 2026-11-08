import "server-only";
import { db } from "@/lib/db";
import { decorateStockDraftReports } from "@/lib/dealer-stock-sync/draft-handoff-store";
import { decorateStockApplyRecovery } from "@/lib/dealer-stock-sync/apply-recovery-store";
import { requireRole } from "@/lib/auth";
import { loadResultHistory } from "@/lib/dealer-stock-sync/result-history-store";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";
import { getWorkerDashboard } from "./worker-actions";

const RECENT_LIMIT = 100;

const reportSelect = {
  id: true,
  dealerId: true,
  bindingId: true,
  scrapeRunId: true,
  fingerprint: true,
  status: true,
  inventoryCount: true,
  failureReason: true,
  createdAt: true,
  plan: true,
  binding: { select: { dealer: { select: { id: true, name: true } } } },
} as const;

function loadReports(statuses: Array<"PENDING_REVIEW" | "APPROVED" | "APPLIED" | "FAILED" | "REJECTED" | "SUPERSEDED">, take?: number) {
  return db.dealerStockSyncReport.findMany({
    where: { status: { in: statuses } },
    orderBy: { createdAt: "desc" },
    ...(take ? { take } : {}),
    select: reportSelect,
  });
}

async function loadJobs() {
  const select = {
      id: true,
      kind: true,
      status: true,
      error: true,
      createdAt: true,
      startedAt: true,
      reportId: true,
      binding: { select: { dealer: { select: { id: true, name: true } } } },
      report: { select: { id: true, status: true } },
  } as const;
  const [active, recent] = await Promise.all([
    db.dealerStockSyncJob.findMany({ where: { status: { in: ["QUEUED", "LEASED"] } }, orderBy: { createdAt: "asc" }, select }),
    db.dealerStockSyncJob.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_LIMIT, select }),
  ]);
  return [...new Map([...active, ...recent].map(job => [job.id, job])).values()];
}

async function loadHandoffReports(loadedIds: string[]) {
  const receipts = await db.stockReviewDraftReceipt.findMany({
    where: { OR: [
      { revisionId: null, listing: { status: { in: ["DRAFT", "PENDING", "REJECTED"] },
        soldAt: null, previewPackId: null, retentionPurgedAt: null } },
      { revision: { status: { in: ["DRAFT", "PENDING"] } }, listing: {
        status: "LIVE", soldAt: null, previewPackId: null, retentionPurgedAt: null,
      } },
    ] },
    distinct: ["reportId"], select: { reportId: true },
  });
  const ids = receipts.map(receipt => receipt.reportId).filter(id => !loadedIds.includes(id));
  return ids.length ? db.dealerStockSyncReport.findMany({
    where: { id: { in: ids } }, orderBy: { createdAt: "desc" }, select: reportSelect,
  }) : [];
}

export async function loadStockReviewSnapshot() {
  await requireRole("ADMIN");
  const [outstanding, recentReports, jobs, profiles, dashboard] = await Promise.all([
    loadReports(["PENDING_REVIEW", "APPROVED", "SUPERSEDED"]),
    loadReports(["APPLIED", "FAILED", "REJECTED"], RECENT_LIMIT),
    loadJobs(),
    db.dealerProfile.findMany({ where: { user: { deletedAt: null, role: "DEALER" } }, select: { id: true, name: true, tier: true, isAdminPreview: true, user: { select: { disabledAt: true } } }, orderBy: { name: "asc" } }),
    getWorkerDashboard(),
  ]);
  const legacy = await loadHandoffReports([...outstanding, ...recentReports].map(report => report.id));
  const savedReports = [...recentReports, ...legacy];
  const enriched = await decorateStockApplyRecovery(await decorateStockDraftReports([...outstanding, ...savedReports]));
  const historyEntries = await loadResultHistory(enriched, jobs);
  const decorated = new Map(enriched.map(report => [report.id, report]));
  const serializeReport = (report: (typeof enriched)[number]) => ({ ...report, createdAt: report.createdAt.toISOString() });
  return {
    outstanding: outstanding.map(report => serializeReport(decorated.get(report.id)!)), recentReports: savedReports.map(report => serializeReport(decorated.get(report.id)!)),
    jobs: jobs.map(job => ({ ...job, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null })),
    profiles: profiles.map(profile => ({ ...profile, user: { disabledAt: profile.user.disabledAt?.toISOString() ?? null } })),
    dashboard, historyEntries, desktopEnabled: resolveDesktopGate(process.env).ok, now: Date.now(),
  };
}
export type StockReviewSnapshot = Awaited<ReturnType<typeof loadStockReviewSnapshot>>;
