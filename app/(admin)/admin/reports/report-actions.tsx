"use client";

import { useState, useTransition } from "react";
import { updateReportStatus } from "@/actions/admin";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";

interface Props {
  reportId: string;
  currentStatus: "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED";
}

export function ReportActions({ reportId, currentStatus }: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateReportStatus({
        reportId,
        status,
        adminNotes: notes || undefined,
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to save report changes.",
        );
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-canvas/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <AdminActionSelect
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED")
          }
          aria-label="Report status"
        >
          <option value="OPEN">OPEN</option>
          <option value="REVIEWED">REVIEWED</option>
          <option value="ACTIONED">ACTIONED</option>
          <option value="DISMISSED">DISMISSED</option>
        </AdminActionSelect>
        <AdminActionButton disabled={isPending} onClick={save} tone="primary">
          Save
        </AdminActionButton>
      </div>
      <AdminActionTextarea
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Admin notes"
        className="mt-2"
      />
      {error ? <p className="mt-2 text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
