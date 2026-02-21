"use client";

import { useState, useTransition } from "react";
import { updateReportStatus } from "@/actions/admin";
import { Button } from "@/components/ui/button";

interface Props {
  reportId: string;
  currentStatus: "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED";
}

export function ReportActions({ reportId, currentStatus }: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateReportStatus({
        reportId,
        status,
        adminNotes: notes || undefined,
      });
      if (result.error) return;
    });
  }

  return (
    <div className="space-y-2">
      <select
        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
        value={status}
        onChange={(event) =>
          setStatus(event.target.value as "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED")
        }
      >
        <option value="OPEN">OPEN</option>
        <option value="REVIEWED">REVIEWED</option>
        <option value="ACTIONED">ACTIONED</option>
        <option value="DISMISSED">DISMISSED</option>
      </select>
      <textarea
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Admin notes"
        className="w-full rounded-md border border-border bg-surface p-2 text-xs"
      />
      <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={save}>
        Save
      </Button>
    </div>
  );
}
