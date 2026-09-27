"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { setMonitoringIssueStatus } from "@/actions/admin/monitoring";

interface Props {
  issueId: string;
}

export function IssueStatusControls({ issueId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [muteHours, setMuteHours] = useState("24");
  const [error, setError] = useState<string | null>(null);

  function submitStatus(status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED") {
    setError(null);
    startTransition(async () => {
      const result = await setMonitoringIssueStatus({
        issueId,
        status,
        mutedHours: status === "MUTED" ? Math.max(1, Number(muteHours) || 24) : undefined,
      });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to update issue");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-text-secondary">
        Update the triage state or mute recurring alerts for a fixed period.
      </p>
      <AdminActionBar>
        <AdminActionButton
          onClick={() => submitStatus("OPEN")}
          disabled={isPending}
        >
          Reopen
        </AdminActionButton>
        <AdminActionButton
          onClick={() => submitStatus("ACKNOWLEDGED")}
          disabled={isPending}
          tone="primary"
        >
          Acknowledge
        </AdminActionButton>
        <AdminActionButton
          onClick={() => submitStatus("RESOLVED")}
          disabled={isPending}
          tone="success"
        >
          Resolve
        </AdminActionButton>
      </AdminActionBar>
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Mute duration (hours)
          <input
            type="number"
            min={1}
            max={24 * 30}
            value={muteHours}
            onChange={(event) => setMuteHours(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary sm:w-32"
          />
        </label>
        <AdminActionButton
          onClick={() => submitStatus("MUTED")}
          disabled={isPending}
          tone="warning"
        >
          Mute alerts
        </AdminActionButton>
      </div>
      {error && <p role="alert" className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
