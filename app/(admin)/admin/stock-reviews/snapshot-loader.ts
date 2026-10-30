import "server-only";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { loadResultHistory } from "@/lib/dealer-stock-sync/result-history-store";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";
import { getWorkerDashboard } from "./worker-actions";

const RECENT_LIMIT = 100;

const reportSelect = {
  id: true,
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

export async function loadStockReviewSnapshot() {
  await requireRole("ADMIN");
  const [outstanding, recentReports, jobs, profiles, dashboard] = await Promise.all([
    loadReports(["PENDING_REVIEW", "APPROVED", "SUPERSEDED"]),
    loadReports(["APPLIED", "FAILED", "REJECTED"], RECENT_LIMIT),
    loadJobs(),
    db.dealerProfile.findMany({ where: { user: { deletedAt: null, role: "DEALER" } }, select: { id: true, name: true, tier: true, isAdminPreview: true, user: { select: { disabledAt: true } } }, orderBy: { name: "asc" } }),
    getWorkerDashboard(),
  ]);
  const historyEntries = await loadResultHistory([...outstanding, ...recentReports], jobs);
  const serializeReport = (report: Awaited<ReturnType<typeof loadReports>>[number]) => ({ ...report, createdAt: report.createdAt.toISOString() });
  return {
    outstanding: outstanding.map(serializeReport), recentReports: recentReports.map(serializeReport),
    jobs: jobs.map(job => ({ ...job, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null })),
    profiles: profiles.map(profile => ({ ...profile, user: { disabledAt: profile.user.disabledAt?.toISOString() ?? null } })),
    dashboard, historyEntries, desktopEnabled: resolveDesktopGate(process.env).ok, now: Date.now(),
  };
}
export type StockReviewSnapshot = Awaited<ReturnType<typeof loadStockReviewSnapshot>>;
