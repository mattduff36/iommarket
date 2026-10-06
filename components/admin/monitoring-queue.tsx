"use client";

import { useState, useTransition } from "react";
import { setMonitoringIssueStatusBulk } from "@/actions/admin/monitoring";
import {
  MonitoringIssueCard,
  monitoringIssueCopy,
  type MonitoringIssueCardData,
} from "@/components/admin/monitoring-issue-card";
import { AdminActionBar, AdminActionButton } from "@/components/admin/admin-action-controls";

export function MonitoringQueue({ issues }: { issues: MonitoringIssueCardData[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [muteHours, setMuteHours] = useState("24");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function apply(status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED") {
    setError(null);
    startTransition(async () => {
      const result = await setMonitoringIssueStatusBulk({
        issueIds: selected,
        status,
        notes: notes.trim() || undefined,
        mutedHours: status === "MUTED" ? Math.max(1, Number(muteHours) || 24) : undefined,
      });
      if ("error" in result) {
        setError("Could not update the selected issues");
        return;
      }
      setSelected([]);
      setNotes("");
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-secondary">
          {selected.length} selected. Acknowledgement stops repeat alerts until the issue escalates or returns after a quiet period.
        </p>
        <label className="mt-3 block text-sm text-text-secondary">
          Triage note
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
            className="mt-1 h-9 w-full rounded-md border border-border bg-canvas px-2 text-sm text-text-primary"
          />
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-sm text-text-secondary">
            Mute hours
            <input
              type="number"
              min={1}
              max={720}
              value={muteHours}
              onChange={(event) => setMuteHours(event.target.value)}
              className="mt-1 h-9 w-28 rounded-md border border-border bg-canvas px-2 text-sm text-text-primary"
            />
          </label>
          <AdminActionBar>
            <AdminActionButton onClick={() => apply("ACKNOWLEDGED")} disabled={isPending || selected.length === 0} tone="primary">
              Acknowledge
            </AdminActionButton>
            <AdminActionButton onClick={() => apply("MUTED")} disabled={isPending || selected.length === 0} tone="warning">
              Mute
            </AdminActionButton>
            <AdminActionButton onClick={() => apply("RESOLVED")} disabled={isPending || selected.length === 0} tone="success">
              Resolve
            </AdminActionButton>
            <AdminActionButton onClick={() => apply("OPEN")} disabled={isPending || selected.length === 0}>
              Reopen
            </AdminActionButton>
          </AdminActionBar>
        </div>
        {error ? <p role="alert" className="mt-2 text-xs text-text-error">{error}</p> : null}
      </div>

      {issues.map((issue) => (
        <div key={issue.id} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-6 h-4 w-4"
            checked={selected.includes(issue.id)}
            onChange={() => toggle(issue.id)}
            aria-label={`Select ${monitoringIssueCopy(issue).subject}`}
          />
          <div className="min-w-0 flex-1">
            <MonitoringIssueCard issue={issue} />
          </div>
        </div>
      ))}
    </div>
  );
}
