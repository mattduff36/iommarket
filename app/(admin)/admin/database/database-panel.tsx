"use client";

import { useState, useTransition } from "react";
import { applyDatabaseSyncAction, prepareDatabaseSyncAction, type PublicDatabaseSyncRun } from "@/actions/admin/database-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const modes = {
  replace: { title: "Replace development", confirmation: "REPLACE DEVELOPMENT", description: "Copy approved production data into development and remove ordinary development-only records from the marketplace. Records needed by payment or review history are archived and hidden. Administrators, the checklist and dealer preview packs are preserved." },
  merge: { title: "Merge production into development", confirmation: "MERGE INTO DEVELOPMENT", description: "Copy approved production records while retaining development-only data. The plan shows updates, preserved records and any conflicts before you apply it." },
  reset: { title: "Reset development", confirmation: "RESET DEVELOPMENT", description: "Clear ordinary development marketplace data while preserving administrators, the checklist and dealer preview packs. Records needed by history are archived and hidden. This does not copy production data or restore a backup." },
} as const;

function dateLabel(value: string | Date) {
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

export function DatabasePanel({ initialRuns, historyError }: { initialRuns: PublicDatabaseSyncRun[]; historyError?: string }) {
  const [runs, setRuns] = useState(initialRuns);
  const [plan, setPlan] = useState<PublicDatabaseSyncRun | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(historyError ?? "");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function prepare(mode: keyof typeof modes) {
    setError(""); setNotice(""); setPlan(null); setConfirmation("");
    startTransition(async () => {
      try {
        const result = await prepareDatabaseSyncAction(mode);
        if ("error" in result) { setError(result.error ?? "Could not prepare the plan."); return; }
        setPlan(result.data);
        setRuns((current) => [result.data, ...current.filter((run) => run.id !== result.data.id)]);
      } catch { setError("Could not prepare the plan. Refresh the page and try again."); }
    });
  }

  function apply() {
    if (!plan) return;
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await applyDatabaseSyncAction({ runId: plan.id, confirmation });
        if ("error" in result) { setError(result.error ?? "Could not apply the plan."); return; }
        setRuns((current) => [result.data, ...current.filter((run) => run.id !== result.data.id)]);
        setNotice(`${modes[result.data.mode].title} completed. Production was not changed.`);
        setPlan(null); setConfirmation("");
      } catch { setError("The operation could not be confirmed. Refresh the history before trying again."); }
    });
  }

  return (
    <div className="space-y-5" aria-busy={pending}>
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text-primary">Manage development data</h2>
        <p className="mt-2 text-sm text-text-secondary">Production is a read-only source. Review a frozen plan first; applying it changes development only and creates a recovery backup. Copied personal details are sanitised. Login accounts, payments and private storage are not cloned.</p>
      </section>
      <section className="grid gap-4 lg:grid-cols-3" aria-label="Database operations">
        {Object.entries(modes).map(([mode, item]) => (
          <div key={mode} className="flex flex-col rounded-lg border border-border bg-surface p-5">
            <h3 className="font-semibold text-text-primary">{item.title}</h3>
            <p className="mt-2 flex-1 text-sm text-text-secondary">{item.description}</p>
            <Button className="mt-4 border border-border" variant="ghost" disabled={pending} onClick={() => prepare(mode as keyof typeof modes)}>Preview {mode} plan</Button>
          </div>
        ))}
      </section>
      {error ? <p role="alert" className="rounded-md border border-neon-red-500/30 p-4 text-sm text-text-primary">{error}</p> : null}
      {notice ? <p role="status" className="rounded-md border border-border p-4 text-sm text-text-primary">{notice}</p> : null}
      {pending ? <p role="status" className="text-sm text-text-secondary">Working on the database plan. Keep this page open until the result appears.</p> : null}
      {plan ? (
        <section aria-labelledby="sync-plan" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="sync-plan" className="text-lg font-semibold text-text-primary">Review: {modes[plan.mode].title}</h2>
          <p className="mt-2 text-sm text-text-secondary">Prepared {dateLabel(plan.createdAt)}. Expires {dateLabel(plan.expiresAt)} (UK time). Changed data or an expired plan requires a fresh preview.</p>
          <p className="mt-3 rounded-md border border-border p-3 text-sm text-text-primary">Archive and hide: {plan.archivedListings.toLocaleString()} listings and {plan.archivedDealers.toLocaleString()} dealer profiles. Their payment and review history is retained. The Remove column below counts physical deletions only; archiving and hiding are reported separately here.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Proposed record changes by table</caption>
              <thead><tr className="border-b border-border text-text-secondary"><th className="py-2">Table</th>{["Add", "Update", "Remove", "Preserve", "Skip"].map((label) => <th key={label} className="px-2 py-2 text-right">{label}</th>)}</tr></thead>
              <tbody>{Object.entries(plan.counts).map(([table, counts]) => <tr key={table} className="border-b border-border/50"><th scope="row" className="py-2 font-medium">{table}</th>{(["insert", "update", "delete", "preserve", "skip"] as const).map((key) => <td key={key} className="px-2 py-2 text-right tabular-nums">{counts[key].toLocaleString()}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {plan.blockers.length ? <div role="alert" className="mt-4"><h3 className="font-semibold">Resolve these issues before applying</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">{plan.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div> : (
            <div className="mt-5 max-w-lg space-y-3">
              <Input label={`Type ${modes[plan.mode].confirmation} to confirm`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" />
              <Button disabled={pending || confirmation !== modes[plan.mode].confirmation} onClick={apply}>Apply {plan.mode} to development</Button>
            </div>
          )}
        </section>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="sync-history">
        <h2 id="sync-history" className="text-lg font-semibold text-text-primary">Recent operations</h2>
        {runs.length ? <ul className="mt-3 divide-y divide-border">{runs.map((run) => <li key={run.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{modes[run.mode].title} · {dateLabel(run.createdAt)}<span className="block text-text-secondary">Archive and hide: {run.archivedListings.toLocaleString()} listings, {run.archivedDealers.toLocaleString()} dealers</span></span><span className="font-medium">{run.status === "applied" ? "Applied" : "Prepared"}</span></li>)}</ul> : <p className="mt-2 text-sm text-text-secondary">No operations recorded.</p>}
      </section>
    </div>
  );
}
