"use client";
import { useState, type ReactNode } from "react";
import { useStockReviewLayout } from "./use-review-layout";
import type { StockReviewSnapshot } from "./snapshot-loader";
import { isStockReviewSnapshot } from "./snapshot-validation";
import { useStockSnapshot, StockSnapshotRefreshProvider } from "./use-stock-snapshot";
import { canRefreshStockPage } from "./refresh-guard";
import { StockResultHistory, StockResultVisibility, StockResultActions } from "./result-history";
import { stockStatusColour, STOCK_STATUS_BADGE } from "@/lib/dealer-stock-sync/status-colour";
import type { ResultHistoryState } from "@/lib/dealer-stock-sync/result-history";
import Link from "@/components/navigation/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ReportableError } from "@/components/monitoring/reportable-error";
import { stockSyncReason, stockSyncStatus, isSoldStockReviewAction } from "@/lib/dealer-stock-sync/review";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";


import { StockDealerPicker } from "./dealer-picker";
import { DownloadStockWorker } from "./download-worker";
import { StockWorkerDashboard } from "./worker-dashboard";
import { StockSyncReviewPanel } from "../dealers/[dealerId]/stock-sync/review-panel";

function actionsOf(plan: unknown, key: "actions" | "pendingReviewActions" = "actions"): PlanAction[] {
  if (!plan || typeof plan !== "object" || !(key in plan)) return [];
  const actions = (plan as Record<string, unknown>)[key];
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
  if (status === "SUPERSEDED" && !needsReview(actions)) return "No change";
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
  if (job.status === "FAILED") return `${name} failed`;
  if (job.report?.status === "APPLIED") return "Applied";
  if (job.report?.status === "FAILED") return "Failed";
  if (job.report?.status === "APPROVED") return "Approved, not applied yet";
  if (job.report?.status === "PENDING_REVIEW") return "Awaiting review";
  return "Finished processing";
}

type ReportRow = StockReviewSnapshot["outstanding"][number];
type JobRow = StockReviewSnapshot["jobs"][number];

function dealerGroups(outstanding: ReportRow[], recentReports: ReportRow[], jobs: JobRow[]) {
  const shownReports = [...outstanding, ...recentReports];
  const shownReportIds = new Set(shownReports.map((report) => report.id));
  const scrapeReports = new Map(shownReports.map((report) => [report.scrapeRunId, report]));
  const visibleJobs = jobs.filter((job) => {
    const reportId = job.report?.id ?? job.reportId ?? scrapeReports.get(job.id)?.id;
    const shown = Boolean(reportId && shownReportIds.has(reportId));
    if (job.status === "QUEUED" || job.status === "LEASED") return true;
    // A failed apply leaves its report approved: never hide that failure behind the report.
    if (job.status === "FAILED") return job.kind === "APPLY" || !shown;
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

function ReportCard({ report, open, onToggle, detail }: { report: ReportRow; open: boolean; onToggle: () => void; detail?: ReactNode }) {
  const allActions = [...actionsOf(report.plan), ...actionsOf(report.plan, "pendingReviewActions")];
  const actions = allActions.filter(action => !isSoldStockReviewAction(action));
  const visibleCount = Math.max(0, report.inventoryCount - allActions.filter(isSoldStockReviewAction).length);
  const warning = warningOf(report.plan);
  const actionable = actions.filter((action) => action.kind === "create" || action.kind === "update").length;
  const blocked = actions.filter((action) => action.kind === "blocked" || action.kind === "conflict").length;
  const removals = removalLabel(report.status, actions);
  const outcome = reportOutcome(report.status, actions);
  const when = new Date(report.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" });
  return (
    <li className={`rounded-lg border px-4 py-3 text-sm transition-colors ${open ? "border-neon-blue-500 bg-neon-blue-500/5" : "border-border bg-surface"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-medium text-text-primary">
        <span className={STOCK_STATUS_BADGE + " " + stockStatusColour(outcome === "No change" ? "no_change" : report.status)}>{outcome}</span> · {visibleCount} vehicles
      </p><StockResultActions id={report.id} /></div>
      <p className="text-text-secondary">
        {actionable} actionable · {blocked} blocked{removals ? ` · ${removals}` : ""} · {when}
      </p>
      {outcome === "No change" ? <p className="text-text-secondary">Nothing to approve. Listings were not changed.</p> : null}
      {report.status === "APPROVED" ? <p className="text-text-secondary">Approval queues processing and does not apply listings by itself.</p> : null}
      {report.status === "APPLIED" ? <p className="text-text-secondary">Listings from this approved plan were applied.</p> : null}
      {report.status === "FAILED" && report.failureReason ? <p className="text-text-secondary">{stockSyncReason(report.failureReason)}</p> : null}
      {warning?.coverageWarning ? <p className="text-text-secondary">{warning.coverageWarning}</p> : null}
      {warning?.capacityWarning ? <p className="text-text-secondary">{warning.capacityWarning}</p> : null}
      <button type="button" id={`review-toggle-${report.id}`} aria-expanded={open} aria-controls={open ? "stock-review-detail" : undefined} onClick={onToggle} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left font-medium text-neon-blue-400 hover:underline">
        {open ? "Close dealer stock review" : "Open dealer stock review"}<span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {detail && <div className="mt-3 border-t border-border pt-4">{detail}</div>}
    </li>
  );
}

export function StockReviewsClient({ initial, query, pairing, offlineStatus }: { initial: StockReviewSnapshot; query: Record<string, string | string[] | undefined>; pairing?: ReactNode; offlineStatus?: ReactNode }) {
  const { snapshot, connectionLost, reload } = useStockSnapshot(initial, canRefreshStockPage, isStockReviewSnapshot);
  const { outstanding, recentReports, jobs, profiles, dashboard, historyEntries } = snapshot;
  // Admin stock management follows the account tier, not billing entitlement.
  // Source setup is handled separately and must not hide an enabled Pro dealer.
  const classified = profiles.filter(profile => !profile.isAdminPreview).map(profile => ({
    ...profile,
    reason: profile.user.disabledAt ? "Dealer account disabled"
      : profile.tier === "STARTER" ? "Starter account" : null,
  }));
  const availableProfiles = classified.filter(profile => !profile.reason);
  const unavailableProfiles = classified.filter(profile => profile.reason).map(profile => ({
    id: profile.id, name: profile.name, reason: profile.reason!,
  }));
  const reportsByRun = new Map([...outstanding, ...recentReports].map(report => [report.scrapeRunId, report]));
  const dealers = dealerGroups(outstanding, recentReports, jobs);
  const historyView: ResultHistoryState = query.history === "archived" || query.history === "deleted" ? query.history : "active";
  const visibleJobs = dealers.flatMap(dealer => dealer.jobs);
  const visibleJobIds = new Set(visibleJobs.map(job => job.id));
  const shownHistory = historyEntries.filter(entry => entry.kind === "report" || visibleJobIds.has(entry.id));

  const { wide, selectedId, toggle } = useStockReviewLayout(typeof query.report === "string" ? query.report : null, historyView);
  const selectedJob = visibleJobs.find(job => `job:${job.id}` === selectedId && historyEntries.some(entry => entry.id === job.id && entry.state === historyView));
  const selectedReport = [...outstanding, ...recentReports].find(report => report.id === (selectedJob ? selectedJob.reportId ?? selectedJob.report?.id ?? reportsByRun.get(selectedJob.id)?.id : selectedId) && historyEntries.some(entry => entry.id === report.id && entry.state === historyView));
  const selectedResult = selectedJob ?? selectedReport;
  const [chosen, setChosen] = useState<{ key: string; indexes: number[] }>({ key: "", indexes: [] });
  const selectionKey = selectedReport ? `${selectedReport.id}:${selectedReport.fingerprint}` : "";
  const detail = selectedResult ? <section id="stock-review-detail" aria-label={`${selectedResult.binding.dealer.name} stock review`} className="space-y-4 scroll-mt-6">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-neon-blue-400">Stock review</p><h2 className="text-xl font-semibold text-text-primary">{selectedResult.binding.dealer.name}</h2></div><button type="button" onClick={() => { toggle(selectedId!); document.getElementById(`review-toggle-${selectedId}`)?.focus(); }} className="min-h-11 rounded-md border border-border px-3 text-sm">Close review</button></div>
    {selectedJob && <div className="space-y-2 rounded-lg border border-border p-4 text-sm"><p className="font-semibold">{jobOutcome(selectedJob)}</p>{selectedJob.error && <ReportableError as="p" className="text-text-error">{selectedJob.error}</ReportableError>}{!selectedReport && <p>No saved review is available for this task yet. Check processing status above, or run a fresh check after a failure.</p>}</div>}
    {selectedReport && <StockSyncReviewPanel key={selectionKey} reportId={selectedReport.id} status={selectedReport.status} fingerprint={selectedReport.fingerprint} failureReason={selectedReport.failureReason} actions={actionsOf(selectedReport.plan)} pendingActions={actionsOf(selectedReport.plan, "pendingReviewActions")} selection={{ indexes: chosen.key === selectionKey ? chosen.indexes : [], setIndexes: indexes => setChosen({ key: selectionKey, indexes }) }} />}
  </section> : null;
  const readyCount = outstanding.filter(report => report.status === "PENDING_REVIEW" && needsReview(actionsOf(report.plan).filter(action => !isSoldStockReviewAction(action)))).length;

  return (
    <StockSnapshotRefreshProvider value={reload}><div className="space-y-8">
      {connectionLost ? <div role="status" className="rounded-md border border-amber-500/40 p-3 text-sm">Updates paused. Showing the last received results; retrying automatically. The worker may still be running. <button type="button" onClick={reload} className="underline">Retry now</button></div> : null}
      <AdminPageHeader
        title="Dealer scrapes"
        description="Review and approve changes before listings update."
      />
      {pairing}
      <StockWorkerDashboard dealers={availableProfiles.map(({ id, name }) => ({ id, name }))} offlineContent={<>
        {offlineStatus}
        {snapshot.desktopEnabled ? <DownloadStockWorker /> : null}
      </>} initialNow={snapshot.now} initial={dashboard} managedSnapshot connectionLost={connectionLost} readyCount={readyCount} jobs={jobs.map(job => ({ id: job.id, dealerName: job.binding.dealer.name, kind: job.kind, status: job.status, reportStatus: job.report?.status ?? reportsByRun.get(job.id)?.status ?? null, startedAt: job.startedAt }))}>
      <StockDealerPicker retainOnDisconnect={connectionLost} dealers={availableProfiles.map(({ id, name }) => ({ id, name }))} unavailable={unavailableProfiles} />
      <StockResultHistory entries={shownHistory} view={historyView}>
      <div data-review-layout={wide ? "split" : "accordion"} className={wide && selectedResult ? "grid min-w-0 grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)] items-start gap-5" : "min-w-0"}>
      <div className={wide && selectedResult ? "max-h-[calc(100dvh-8rem)] space-y-5 overflow-y-auto pr-2" : "space-y-5"}>
      {dealers.length === 0 ? (
        <p className="text-sm text-text-tertiary">No dealer scrapes yet.</p>
      ) : (
        dealers.map((dealer) => (
          <StockResultVisibility key={dealer.dealerId} ids={[...dealer.outstanding.map(report => report.id), ...dealer.recentReports.map(report => report.id), ...dealer.jobs.map(job => job.id)]}><section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">
              <Link href={`/admin/dealers/${dealer.dealerId}/stock-sync`} className="hover:underline">
                {dealer.name}
              </Link>
            </h2>
            {dealer.outstanding.length > 0 ? (
              <ul className="space-y-2">
                {dealer.outstanding.map((report) => (
                  <StockResultVisibility key={report.id} ids={[report.id]}><ReportCard report={report} open={selectedId === report.id} onToggle={() => toggle(report.id)} detail={!wide && selectedId === report.id ? detail : undefined} /></StockResultVisibility>
                ))}
              </ul>
            ) : null}
            {dealer.recentReports.length > 0 || dealer.jobs.length > 0 ? (
              <StockResultVisibility ids={[...dealer.recentReports.map(report => report.id), ...dealer.jobs.map(job => job.id)]}><div className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">Recent runs</h3>
                <ul className="space-y-2">
                  {dealer.recentReports.map((report) => (
                    <StockResultVisibility key={report.id} ids={[report.id]}><ReportCard report={report} open={selectedId === report.id} onToggle={() => toggle(report.id)} detail={!wide && selectedId === report.id ? detail : undefined} /></StockResultVisibility>
                  ))}
                  {dealer.jobs.map((job) => (
                    <StockResultVisibility key={job.id} ids={[job.id]}><li className="rounded-md border border-border px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-medium text-text-primary"><span className={STOCK_STATUS_BADGE + " " + stockStatusColour(job.status)}>{jobOutcome(job)}</span></p><StockResultActions id={job.id} /></div>
                      {job.status === "SUCCEEDED" ? <p className="text-sm text-text-secondary">Open the dealer stock review to check the saved result.</p> : null}
                      {job.status === "FAILED" && !job.reportId ? <p className="text-sm text-text-secondary">No report was saved.</p> : null}
                      <p className="text-text-secondary">{new Date(job.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</p>
                      {job.status === "FAILED" && job.error ? <p className="text-text-secondary">{job.error}</p> : null}
                      <button type="button" id={`review-toggle-job:${job.id}`} aria-expanded={selectedJob?.id === job.id} aria-controls={selectedJob?.id === job.id ? "stock-review-detail" : undefined} onClick={() => toggle(`job:${job.id}`)} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left font-medium text-neon-blue-400 hover:underline">{selectedJob?.id === job.id ? "Close dealer stock review" : "Open dealer stock review"}<span aria-hidden="true">{selectedJob?.id === job.id ? "−" : "+"}</span></button>
                      {!wide && selectedJob?.id === job.id && <div className="mt-3 border-t border-border pt-4">{detail}</div>}
                    </li></StockResultVisibility>
                  ))}
                </ul>
              </div></StockResultVisibility>
            ) : null}
          </section></StockResultVisibility>
        ))
      )}
      </div>
      {wide && selectedResult && <aside className="sticky top-4 h-[calc(100dvh-8rem)] min-w-0 overflow-y-auto rounded-xl border border-neon-blue-500/30 bg-surface p-5">{detail}</aside>}
      </div>
      </StockResultHistory>
      </StockWorkerDashboard>
    </div></StockSnapshotRefreshProvider>
  );
}
