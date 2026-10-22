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

const RECENT_LIMIT = 20;

const reportSelect = {
  id: true,
  scrapeRunId: true,
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

function loadJobs() {
  return db.dealerStockSyncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: {
      id: true,
      kind: true,
      status: true,
      error: true,
      createdAt: true,
      reportId: true,
      binding: { select: { dealer: { select: { id: true, name: true } } } },
      report: { select: { id: true, status: true } },
    },
  });
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

function ReportCard({ report, dealerId }: { report: ReportRow; dealerId: string }) {
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
      <Link href={`/admin/dealers/${dealerId}/stock-sync`} className="text-neon-blue-400 hover:underline">
        Open dealer stock review
      </Link>
    </li>
  );
}

export default async function AdminStockReviewsPage() {
  await requireRole("ADMIN");
  const [outstanding, recentReports, jobs, bindings] = await Promise.all([
    loadReports(["PENDING_REVIEW", "APPROVED"]),
    loadReports(["APPLIED", "FAILED"], RECENT_LIMIT),
    loadJobs(),
    db.dealerStockSourceBinding.findMany({ where: { verifiedAt: { not: null } }, select: { dealer: { select: { id: true, name: true } } }, orderBy: { dealer: { name: "asc" } } }),
  ]);
  const dealers = dealerGroups(outstanding, recentReports, jobs);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Stock reviews"
        description="Outstanding website-stock reviews and recent worker runs. Approve changes on the dealer stock review page. A finished job is not proof that listings were applied."
      />
      <StockDealerPicker dealers={bindings.map(binding => binding.dealer)} />
      <p className="text-sm text-text-secondary">
        Every pending and approved review is listed. Recent history is the latest {RECENT_LIMIT} applied or failed reports and the latest {RECENT_LIMIT} jobs.
      </p>
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
                  <ReportCard key={report.id} report={report} dealerId={dealer.dealerId} />
                ))}
              </ul>
            ) : null}
            {dealer.recentReports.length > 0 || dealer.jobs.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">Recent runs</h3>
                <ul className="space-y-2">
                  {dealer.recentReports.map((report) => (
                    <ReportCard key={report.id} report={report} dealerId={dealer.dealerId} />
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
    </div>
  );
}
