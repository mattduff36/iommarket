"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { createContext, useContext, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStockSnapshotRefresh } from "./use-stock-snapshot";
import Link from "@/components/navigation/link";
import { changeStockResultHistory } from "@/actions/admin/stock-result-history";
import type { ResultHistoryEntry, ResultHistoryState } from "@/lib/dealer-stock-sync/result-history";

const History = createContext<{ entries: ResultHistoryEntry[]; view: ResultHistoryState }>({ entries: [], view: "active" });
const BUTTON = "min-h-11 rounded-md border border-border px-3 text-sm hover:bg-surface-elevated disabled:opacity-50";

export function StockResultHistory({ entries, view, children }: {
  entries: ResultHistoryEntry[]; view: ResultHistoryState; children: ReactNode;
}) {
  const visible = entries.filter(entry => entry.state === view);
  return <History.Provider value={{ entries, view }}>
    <div className="flex flex-wrap items-center gap-3">
      <h2 id="stock-review-results" className="text-xl font-semibold text-text-primary">Results</h2>
      <nav aria-label="Result history" className="flex flex-wrap gap-2">
        {(["active", "archived", "deleted"] as const).map(state => <Link key={state}
          href={`/admin/stock-reviews?history=${state}#stock-review-results`}
          aria-current={view === state ? "page" : undefined}
          className={BUTTON + " inline-flex items-center " + (view === state ? "border-neon-blue-500 text-neon-blue-400" : "text-text-primary")}>
          {{active:"Active",archived:"Archived",deleted:"Deleted"}[state]} ({entries.filter(entry => entry.state === state).length})
        </Link>)}
      </nav>
    </div>
    <p className="text-sm text-text-secondary">Applied and no change results are archived automatically. Restoring a deleted no change result returns it to Archived. Changes are saved across computers. Deleting a result never deletes listings.</p>
    {visible.length === 0 ? <p className="text-sm text-text-secondary">No {view} results.</p> : null}
    {children}
  </History.Provider>;
}

export function StockResultVisibility({ ids, children }: { ids: string[]; children: ReactNode }) {
  const { entries, view } = useContext(History);
  return ids.length > 0 && !ids.some(id => entries.some(entry => entry.id === id && entry.state === view)) ? null : children;
}

export function StockResultActions({ id }: { id: string }) {
  const { entries } = useContext(History);
  const entry = entries.find(row => row.id === id);
  const router = useRouter();
  const reloadSnapshot = useStockSnapshotRefresh();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unavailableId = useId();
  if (!entry) return null;
  const disabled = pending || !entry.manageable;
  const unavailableReason = entry.kind === "job"
    ? "Finish or cancel this task before archiving or deleting its result."
    : "Resolve outstanding review items and draft handoffs before archiving or deleting this result.";

  function run(action: "archive" | "delete" | "restore") {
    if (!entry?.manageable) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeStockResultHistory({ id, kind: entry.kind, action });
        if ("error" in result) { setError(result.error ?? "Could not update this result."); return; }
        setConfirmDelete(false);
        if (reloadSnapshot) reloadSnapshot(); else router.refresh();
      } catch { setError("Could not update this result. Please try again."); }
    });
  }
  return <div className="ml-auto flex max-w-full flex-col items-end gap-2" aria-describedby={!entry.manageable ? unavailableId : undefined} title={!entry.manageable ? unavailableReason : undefined}>
    {confirmDelete ? <div role="group" aria-label="Confirm result deletion" className="max-w-sm rounded-md border border-border bg-surface p-3 text-sm">
      <p>Delete this result from the results list? Listings are unaffected. You can restore it from Deleted.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className={BUTTON + " text-red-300"} onClick={() => run("delete")}>Confirm delete</button>
        <button type="button" disabled={disabled} className={BUTTON} onClick={() => setConfirmDelete(false)}>Cancel</button>
      </div>
    </div> : <div className="flex flex-wrap justify-end gap-2">
      {entry.state === "active" ? <button type="button" disabled={disabled} className={BUTTON} onClick={() => run("archive")}>Archive</button>
        : entry.state === "archived" && entry.restoreState === "archived" ? null
          : <button type="button" disabled={disabled} className={BUTTON} onClick={() => run("restore")}>{entry.restoreState === "archived" ? "Restore to Archived" : "Restore"}</button>}
      {entry.state !== "deleted" ? <button type="button" disabled={disabled} className={BUTTON + " text-red-300"} onClick={() => setConfirmDelete(true)}>Delete</button> : null}
    </div>}
    {!entry.manageable ? <p id={unavailableId} className="max-w-xs text-xs text-text-secondary">{unavailableReason}</p> : null}
    {error ? <ReportableError as="p" role="alert" className="text-sm text-red-300">{error}</ReportableError> : null}
  </div>;
}
