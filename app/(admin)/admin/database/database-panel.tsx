"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { applyDatabaseSyncAction, prepareDatabaseSyncAction, loadDatabaseSyncRuns, type PublicDatabaseSyncRun } from "@/actions/admin/database-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SCOPED_MERGE_ONLY, SYNC_SCOPE_DESCRIPTION } from "@/lib/database-sync/scope-policy";

const modes = {
  replace: { title: "Replace development", confirmation: "REPLACE DEVELOPMENT", description: "Copy every current production table and column into development, including featured listings, users, payments and subscriptions. Staging administrator sign-in stays in place. Imported accounts cannot sign in." },
  merge: { title: "Merge production into development", confirmation: "MERGE INTO DEVELOPMENT", description: "Copy in-scope production records while keeping development-only and excluded rows. Matching identities are updated. Only conflicts in included records can block this plan." },
  reset: { title: "Reset development", confirmation: "RESET DEVELOPMENT", description: "Remove development marketplace rows while preserving staging administrator sign-in. This does not copy production data or restore a backup." },
} as const;

type PendingOperation =
  | { kind: "prepare"; mode: keyof typeof modes }
  | { kind: "apply"; mode: keyof typeof modes }
  | { kind: "history" };

function dateLabel(value: string | Date) {
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function backupLabel(run: PublicDatabaseSyncRun) {
  if (run.backupState === "newest") return "Newest backup kept until a later backup replaces it.";
  if (run.backupState === "retained" && run.backupExpiresAt) return `Backup expires ${dateLabel(run.backupExpiresAt)} (UK time).`;
  if (run.backupState === "expired") return "Backup expired and was removed.";
  return run.status === "applied" ? "No restorable backup." : "Prepared plans are not restorable.";
}

export function DatabasePanel({ initialRuns, historyError }: { initialRuns: PublicDatabaseSyncRun[]; historyError?: string }) {
  const [runs, setRuns] = useState(initialRuns);
  const [plan, setPlan] = useState<PublicDatabaseSyncRun | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const feedbackRef = useRef<HTMLDivElement>(null);
  const operationLock = useRef(false);
  const [uncertainRunId, setUncertainRunId] = useState<string | null>(null);
  const [error, setError] = useState(historyError ?? "");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [pending, startTransition] = useTransition();

  function prepare(mode: keyof typeof modes) {
    if (operationLock.current || mode !== "merge" || uncertainRunId) return;
    operationLock.current = true;
    setError(""); setNotice(""); setPlan(null); setConfirmation("");
    setOperation({ kind: "prepare", mode });
    startTransition(async () => {
      try {
        const result = await prepareDatabaseSyncAction(mode);
        if ("error" in result) { setError(result.error ?? "Could not prepare the plan."); return; }
        setPlan(result.data);
        setRuns((current) => [result.data, ...current.filter((run) => run.id !== result.data.id)]);
        setNotice(`Plan prepared for ${modes[result.data.mode].title.toLowerCase()}. Review the counts and blockers below.`);
      } catch { setError("Could not prepare the plan. Refresh the page and try again."); }
      finally { operationLock.current = false; setOperation(null); }
    });
  }

  function apply() {
    if (!plan || operationLock.current || uncertainRunId) return;
    operationLock.current = true;
    setError(""); setNotice("");
    setOperation({ kind: "apply", mode: plan.mode });
    startTransition(async () => {
      try {
        const result = await applyDatabaseSyncAction({ runId: plan.id, confirmation });
        if ("error" in result) { setError(result.error ?? "Could not apply the plan."); return; }
        if (result.data.status !== "applied") {
          setUncertainRunId(plan.id);
          setError("The server did not confirm completion. Check saved operation status before trying again.");
          return;
        }
        setRuns((current) => [result.data, ...current.filter((run) => run.id !== result.data.id)]);
        const warning = "warning" in result && typeof result.warning === "string" ? ` ${result.warning}` : "";
        setNotice(`${modes[result.data.mode].title} completed successfully. Production was not changed.${warning}`);
        setPlan(null); setConfirmation("");
      } catch {
        setUncertainRunId(plan.id);
        setError("The connection ended before completion could be confirmed. Use Refresh history to check the saved outcome before trying again.");
      }
      finally { operationLock.current = false; setOperation(null); }
    });
  }

  function refreshHistory() {
    if (operationLock.current) return;
    operationLock.current = true;
    setOperation({ kind: "history" });
    startTransition(async () => {
      try {
        const result = await loadDatabaseSyncRuns();
        if ("error" in result) { setError(result.error ?? "Could not load operation history."); return; }
        setRuns(result.data);
        const current = result.data.find((run) => run.id === (uncertainRunId ?? plan?.id));
        if (current?.status === "applied") {
          setError(""); setUncertainRunId(null); setPlan(null); setConfirmation("");
          setNotice("Merge completed successfully. The saved operation is Applied. Production was not changed.");
        } else if (uncertainRunId) {
          setNotice("");
          setError("Completion is not confirmed. The saved operation is still prepared or unavailable. Do not submit another merge while the earlier request may still be running. Refresh history again before retrying.");
        } else {
          setNotice("Operation history refreshed from the database.");
        }
      } catch { setError("Operation history could not be loaded. No new merge was submitted."); }
      finally { operationLock.current = false; setOperation(null); }
    });
  }

  const progress = operation?.kind === "prepare"
    ? `Request received. Preparing the ${operation.mode} plan by reading and encrypting a consistent snapshot. Keep this page open.`
    : operation?.kind === "apply"
      ? `Confirmation received. Applying the ${operation.mode} plan to development. Production remains read-only.`
      : operation?.kind === "history"
        ? "Checking saved operation status. No new merge is being submitted."
        : "";

  useEffect(() => {
    if (!error && !notice && !progress) return;
    feedbackRef.current?.focus({ preventScroll: true });
    feedbackRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [error, notice, progress]);

  return (
    <div className="space-y-5" aria-busy={pending || Boolean(operation)}>
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-text-primary">Manage development data</h2>
        <p className="mt-2 text-sm text-text-secondary">Production is a read-only source. A reviewed plan copies only included marketplace records and disabled authentication identities into development, with a private encrypted backup of included staging data taken before application. The newest backup is kept. When a newer backup is saved, the previous one expires after 30 days. At most four older backups are kept, within a 500 MB ciphertext limit.</p>
      </section>
      <p className="rounded-md border border-border p-4 text-sm text-text-secondary">{SYNC_SCOPE_DESCRIPTION} The two explicitly excluded user accounts are also ignored. {SCOPED_MERGE_ONLY}</p>
      <section className="grid gap-4 lg:grid-cols-3" aria-label="Database operations">
        {Object.entries(modes).map(([mode, item]) => (
          <div key={mode} className="flex flex-col rounded-lg border border-border bg-surface p-5">
            <h3 className="font-semibold text-text-primary">{item.title}</h3>
            <p className="mt-2 flex-1 text-sm text-text-secondary">{item.description}</p>
            <Button
              className="mt-4 border border-border"
              variant="ghost"
              type="button"
              disabled={mode !== "merge" || pending || Boolean(operation) || Boolean(uncertainRunId)}
              title={mode !== "merge" ? SCOPED_MERGE_ONLY : undefined}
              loading={operation?.kind === "prepare" && operation.mode === mode}
              onClick={() => prepare(mode as keyof typeof modes)}
            >
              {operation?.kind === "prepare" && operation.mode === mode ? `Preparing ${mode} plan…` : `Preview ${mode} plan`}
            </Button>
            {mode !== "merge" ? <p className="mt-2 text-xs text-text-secondary">Unavailable while the current exclusions are active.</p> : null}
          </div>
        ))}
      </section>
      {(error || notice || progress) ? (
        <div ref={feedbackRef} tabIndex={-1} role={error ? "alert" : "status"} aria-atomic="true"
          className={`scroll-mt-24 rounded-md border p-4 text-sm text-text-primary focus:outline-none ${error ? "border-neon-red-500/50" : "border-border bg-surface"}`}>
          {progress || error || notice}
          {uncertainRunId ? <Button type="button" className="mt-3 block border border-border" variant="ghost" disabled={pending || Boolean(operation)} onClick={refreshHistory}>Check saved operation status</Button> : null}
        </div>
      ) : null}
      {plan ? (
        <section aria-labelledby="sync-plan" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="sync-plan" className="text-lg font-semibold text-text-primary">Review: {modes[plan.mode].title}</h2>
          <p className="mt-2 text-sm text-text-secondary">Prepared {dateLabel(plan.createdAt)}. Expires {dateLabel(plan.expiresAt)} (UK time). Changed data or an expired plan requires a fresh preview.</p>
          <p className="mt-3 rounded-md border border-border p-3 text-sm text-text-primary">Included production values are copied as stored, including featured listings. Excluded records and staging administrator sign-in stay untouched. Imported accounts cannot authenticate.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-2 text-left text-sm text-text-secondary">Captured is the included production snapshot size. Skip also counts excluded source records. Preserve includes existing staging records that will not be changed.</caption>
              <thead><tr className="border-b border-border text-text-secondary"><th className="py-2">Table</th><th className="px-2 py-2 text-right">Captured</th>{["Add", "Update", "Remove", "Preserve", "Skip"].map((label) => <th key={label} className="px-2 py-2 text-right">{label}</th>)}</tr></thead>
              <tbody>{Object.entries(plan.counts).map(([table, counts]) => <tr key={table} className="border-b border-border/50"><th scope="row" className="py-2 font-medium">{table}</th><td className="px-2 py-2 text-right tabular-nums">{typeof counts.captured === "number" ? counts.captured.toLocaleString() : "—"}</td>{(["insert", "update", "delete", "preserve", "skip"] as const).map((key) => <td key={key} className="px-2 py-2 text-right tabular-nums">{counts[key].toLocaleString()}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {plan.reconciled?.length ? <div className="mt-4"><h3 className="font-semibold text-text-primary">Scope and identity reconciliation</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">{plan.reconciled.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {plan.blockers.length ? <div role="alert" className="mt-4"><h3 className="font-semibold">Resolve these issues before applying</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">{plan.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div> : (
            <div className="mt-5 max-w-lg space-y-3">
              <Input label={`Type ${modes[plan.mode].confirmation} to confirm`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" />
              <Button
                type="button"
                disabled={pending || Boolean(operation) || Boolean(uncertainRunId) || confirmation !== modes[plan.mode].confirmation}
                loading={operation?.kind === "apply"}
                onClick={apply}
              >
                {operation?.kind === "apply" ? `Applying ${plan.mode}…` : `Apply ${plan.mode} to development`}
              </Button>
            </div>
          )}
        </section>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="sync-history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sync-history" className="text-lg font-semibold text-text-primary">Recent operations</h2>
          <Button type="button" variant="ghost" className="border border-border" disabled={pending || Boolean(operation)} onClick={refreshHistory}>Refresh history</Button>
        </div>
        <p className="mt-2 text-sm text-text-secondary">Restore is unavailable while the exclusions are active. Saved backups are retained.</p>
        {runs.length ? <ul className="mt-3 divide-y divide-border">{runs.map((run) => (
          <li key={run.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span>{run.kind === "restore" ? "Restore development" : modes[run.mode].title} · {dateLabel(run.createdAt)}<span className="block text-text-secondary">{backupLabel(run)}</span></span>
              <span className="font-medium">{run.status === "applied" ? "Applied" : "Prepared"}</span>
            </div>
            <Button type="button" className="mt-3 border border-border" variant="ghost" disabled title={SCOPED_MERGE_ONLY}>Restore</Button>
          </li>
        ))}</ul> : <p className="mt-2 text-sm text-text-secondary">No operations recorded.</p>}
      </section>
    </div>
  );
}
