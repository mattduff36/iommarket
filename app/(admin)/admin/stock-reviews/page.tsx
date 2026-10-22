export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "@/components/navigation/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { stockSyncReason, stockSyncStatus, isSoldStockReviewAction } from "@/lib/dealer-stock-sync/review";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Stock reviews | Admin" };

import { StockDealerPicker } from "./dealer-picker";
import { StockWorkerDashboard } from "./worker-dashboard";
import { StockWorkerPairing } from "./worker-pairing";
import { getWorkerDashboard } from "./worker-actions";
import { StockSyncReviewPanel } from "../dealers/[dealerId]/stock-sync/review-panel";

const RECENT_LIMIT = 20;

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

function actionsOf(plan: unknown): PlanAction[] {
  if (!plan || typeof plan !== "object" || !("actions" in plan)) return [];
  const actions = (plan as { actions?: unknown }).actions;
  return Array.isArray(actions) ? (actions as PlanAction[]) : [];
}

function warningOf(plan: unknown) {
  if (!plan || typeof plan !== "object" || !("reviewSource" in plan)) return null;
  const source = (plan as { reviewSource?: { coverageWarning?: unknown; capacityWarning?: unknown } }).reviewSource;
  if (!source) return null;
  return {
    coverageWarning: typeof source.coverageWarning === "string" ? source.coverageWarning : null,
    capacityWarning: typeof source.capacityWarning === "string" ? source.capacityWarning : null,
  };
}

function needsReview(actions: PlanAction[]) {
  return actions.some((action) =>
    action.kind === "create" || action.kind === "update" || action.kind === "unpublish" || action.kind === "blocked" || action.kind === "conflict",
  );
}

function reportOutcome(status: string, actions: PlanAction[]) {
  if (status === "PENDING_REVIEW") return needsReview(actions) ? "Awaiting review" : "No change";
  if (status === "APPROVED") return "Approved, not applied yet";
  if (status === "APPLIED") return "Applied";
  if (status === "FAILED") return "Failed";
  return stockSyncStatus(status);
}

function removalLabel(status: string, actions: PlanAction[]) {
  const removals = actions.filter((action) => action.kind === "unpublish").length;
  if (removals === 0) return null;
  const noun = removals === 1 ? "removal" : "removals";
  return status === "APPLIED" ? `${removals} ${noun}` : `${removals} proposed ${noun}`;
}

function jobOutcome(job: { kind: string; status: string; reportId: string | null; report: { status: string } | null }) {
  const name = job.kind === "APPLY" ? "Apply" : "Check";
  if (job.status === "QUEUED") return `${name} queued`;
  if (job.status === "LEASED") return `${name} processing`;
  if (job.status === "CANCELLED") return `${name} cancelled`;
  if (job.status === "FAILED") return job.reportId ? `${name} failed` : `${name} failed. No report was saved.`;
  if (job.report?.status === "APPLIED") return "Applied. The saved report shows the listings were applied.";
  if (job.report?.status === "FAILED") return "Failed. The saved report shows the check failed.";
  if (job.report?.status === "APPROVED") return "Approved, not applied yet";
  if (job.report?.status === "PENDING_REVIEW") return "Finished processing. Listings were not applied.";
  return "Finished processing. Open the dealer stock review to check the saved result.";
}

type ReportRow = Awaited<ReturnType<typeof loadReports>>[number];
type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];

function loadReports(statuses: Array<"PENDING_REVIEW" | "APPROVED" | "APPLIED" | "FAILED">, take?: number) {
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

function dealerGroups(outstanding: ReportRow[], recentReports: ReportRow[], jobs: JobRow[]) {
  const shownReports = [...outstanding, ...recentReports];
  const shownReportIds = new Set(shownReports.map((report) => report.id));
  const scrapeReports = new Map(shownReports.map((report) => [report.scrapeRunId, report]));
  const visibleJobs = jobs.filter((job) => {
    const reportId = job.report?.id ?? job.reportId ?? scrapeReports.get(job.id)?.id;
    const shown = Boolean(reportId && shownReportIds.has(reportId));
    if (job.status === "QUEUED" || job.status === "LEASED") return true;
    // A failed apply leaves its report approved: never hide that failure behind the report.
    if (job.status === "FAILED") return true;
    if (job.status === "SUCCEEDED" || job.status === "CANCELLED") return !shown;
    return false;
  });
  const groups = new Map<string, { dealerId: string; name: string; outstanding: ReportRow[]; recentReports: ReportRow[]; jobs: JobRow[] }>();
  const ensure = (dealerId: string, name: string) => {
    const current = groups.get(dealerId) ?? { dealerId, name, outstanding: [], recentReports: [], jobs: [] };
    groups.set(dealerId, current);
    return current;
  };
  for (const report of outstanding) {
    const dealer = report.binding.dealer;
    const current = ensure(dealer.id, dealer.name);
    groups.set(dealer.id, { ...current, outstanding: [...current.outstanding, report] });
  }
  for (const report of recentReports) {
    const dealer = report.binding.dealer;
    const current = ensure(dealer.id, dealer.name);
    groups.set(dealer.id, { ...current, recentReports: [...current.recentReports, report] });
  }
  for (const job of visibleJobs) {
    const dealer = job.binding.dealer;
    const current = ensure(dealer.id, dealer.name);
    groups.set(dealer.id, { ...current, jobs: [...current.jobs, job] });
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function ReportCard({ report }: { report: ReportRow }) {
  const allActions = actionsOf(report.plan);
  const actions = allActions.filter(action => !isSoldStockReviewAction(action));
  const visibleCount = Math.max(0, report.inventoryCount - allActions.filter(isSoldStockReviewAction).length);
  const warning = warningOf(report.plan);
  const actionable = actions.filter((action) => action.kind === "create" || action.kind === "update").length;
  const blocked = actions.filter((action) => action.kind === "blocked" || action.kind === "conflict").length;
  const removals = removalLabel(report.status, actions);
  const outcome = reportOutcome(report.status, actions);
  const when = report.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" });
  return (
    <li className="rounded-md border border-border px-4 py-3 text-sm">
      <p className="font-medium text-text-primary">
        {outcome} · {visibleCount} vehicles
      </p>
      <p className="text-text-secondary">
        {actionable} actionable · {blocked} blocked{removals ? ` · ${removals}` : ""} · {when}
      </p>
      {outcome === "No change" ? <p className="text-text-secondary">Nothing to approve. Listings were not changed.</p> : null}
      {report.status === "APPROVED" ? <p className="text-text-secondary">Approval queues processing and does not apply listings by itself.</p> : null}
      {report.status === "APPLIED" ? <p className="text-text-secondary">Listings from this approved plan were applied.</p> : null}
      {report.status === "FAILED" && report.failureReason ? <p className="text-text-secondary">{stockSyncReason(report.failureReason)}</p> : null}
      {warning?.coverageWarning ? <p className="text-text-secondary">{warning.coverageWarning}</p> : null}
      {warning?.capacityWarning ? <p className="text-text-secondary">{warning.capacityWarning}</p> : null}
      <Link href={`/admin/stock-reviews?report=${report.id}#stock-review-detail`} className="text-neon-blue-400 hover:underline">
        Open dealer stock review
      </Link>
    </li>
  );
}

export default async function AdminStockReviewsPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  await requireRole("ADMIN");
  const query = await searchParams ?? {};
  const [outstanding, recentReports, jobs, profiles, dashboard] = await Promise.all([
    loadReports(["PENDING_REVIEW", "APPROVED"]),
    loadReports(["APPLIED", "FAILED"], RECENT_LIMIT),
    loadJobs(),
    db.dealerProfile.findMany({ where: { user: { deletedAt: null, role: "DEALER" } }, select: { id: true, name: true, isAdminPreview: true, user: { select: { disabledAt: true } }, stockSourceBinding: { select: { verifiedAt: true } } }, orderBy: { name: "asc" } }),
    getWorkerDashboard(),
  ]);
  const availableProfiles = profiles.filter(profile => !profile.isAdminPreview && !profile.user.disabledAt && profile.stockSourceBinding?.verifiedAt);
  const unavailableProfiles = profiles.filter(profile => !availableProfiles.some(available => available.id === profile.id)).map(profile => ({ id: profile.id, name: profile.name, reason: profile.isAdminPreview ? "Preview/demo profile — an active dealer account is required" : profile.user.disabledAt ? "Dealer account disabled" : "Website source needs setup" }));
  const reportsByRun = new Map([...outstanding, ...recentReports].map(report => [report.scrapeRunId, report]));
  const dealers = dealerGroups(outstanding, recentReports, jobs);
  const selectedReport = [...outstanding, ...recentReports].find(report => report.id === query.report);
  const readyCount = outstanding.filter(report => report.status === "PENDING_REVIEW" && needsReview(actionsOf(report.plan).filter(action => !isSoldStockReviewAction(action)))).length;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Stock reviews"
        description="Choose dealers, follow the worker live, then review and approve the proposed changes here. Listings change only after approval and successful processing."
      />
      <StockWorkerPairing code={typeof query.code === "string" ? query.code : ""} status={typeof query.status === "string" ? query.status : ""} />
      <StockWorkerDashboard initialNow={Date.now()} initial={dashboard} readyCount={readyCount} jobs={jobs.map(job => ({ id: job.id, dealerName: job.binding.dealer.name, kind: job.kind, status: job.status, reportStatus: job.report?.status ?? reportsByRun.get(job.id)?.status ?? null, startedAt: job.startedAt?.toISOString() ?? null }))}>
      <StockDealerPicker dealers={availableProfiles.map(({ id, name }) => ({ id, name }))} unavailable={unavailableProfiles} />
      <p id="stock-review-results" className="text-sm text-text-secondary">
        Every pending and approved review is listed. Recent history is the latest {RECENT_LIMIT} applied or failed reports and the latest {RECENT_LIMIT} jobs.
      </p>
      {selectedReport ? <section id="stock-review-detail" className="space-y-4 scroll-mt-6 rounded-xl border border-neon-blue-500/30 p-4">
        <h2 className="text-xl font-semibold text-text-primary">{selectedReport.binding.dealer.name}</h2>
        <StockSyncReviewPanel reportId={selectedReport.id} status={selectedReport.status} fingerprint={selectedReport.fingerprint} failureReason={selectedReport.failureReason} actions={actionsOf(selectedReport.plan)} />
      </section> : null}
      {dealers.length === 0 ? (
        <p className="text-sm text-text-tertiary">No pending or approved stock reviews and no recent worker runs.</p>
      ) : (
        dealers.map((dealer) => (
          <section key={dealer.dealerId} className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">
              <Link href={`/admin/dealers/${dealer.dealerId}/stock-sync`} className="hover:underline">
                {dealer.name}
              </Link>
            </h2>
            {dealer.outstanding.length > 0 ? (
              <ul className="space-y-2">
                {dealer.outstanding.map((report) => (
                  <ReportCard key={report.id} report={report} />
                ))}
              </ul>
            ) : null}
            {dealer.recentReports.length > 0 || dealer.jobs.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">Recent runs</h3>
                <ul className="space-y-2">
                  {dealer.recentReports.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                  {dealer.jobs.map((job) => (
                    <li key={job.id} className="rounded-md border border-border px-4 py-3 text-sm">
                      <p className="font-medium text-text-primary">{jobOutcome(job)}</p>
                      <p className="text-text-secondary">{job.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}</p>
                      {job.status === "FAILED" && job.error ? <p className="text-text-secondary">{job.error}</p> : null}
                      <Link href={`/admin/dealers/${dealer.dealerId}/stock-sync`} className="text-neon-blue-400 hover:underline">
                        Open dealer stock review
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ))
      )}
      </StockWorkerDashboard>
    </div>
  );
}
