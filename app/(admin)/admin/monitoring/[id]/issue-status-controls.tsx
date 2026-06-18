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
    <div className="space-y-3">
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
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={24 * 30}
          value={muteHours}
          onChange={(event) => setMuteHours(event.target.value)}
          className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
          aria-label="Mute duration in hours"
        />
        <AdminActionButton
          onClick={() => submitStatus("MUTED")}
          disabled={isPending}
          tone="warning"
        >
          Mute for Hours
        </AdminActionButton>
      </div>
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
