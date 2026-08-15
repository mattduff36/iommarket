"use client";

import { useState, useTransition } from "react";
import { processDealerCancellationRequest } from "@/actions/admin/cancellations";
import {
  AdminActionButton,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";

interface Props {
  requestId: string;
  status: "REQUESTED" | "ACKNOWLEDGED" | "RECONCILED" | "COMPLETED" | "REJECTED";
}

export function CancellationActions({ requestId, status }: Props) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: "ACKNOWLEDGE" | "RECONCILE" | "REJECT" | "COMPLETE") {
    setError(null);
    startTransition(async () => {
      const result = await processDealerCancellationRequest({
        requestId,
        action,
        notes: notes || undefined,
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to update the cancellation request.",
        );
      }
    });
  }

  return (
    <div className="space-y-2">
      <AdminActionTextarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Staff notes"
      />
      <div className="flex flex-wrap gap-2">
        {status === "REQUESTED" ? (
          <AdminActionButton
            disabled={isPending}
            onClick={() => run("ACKNOWLEDGE")}
          >
            Acknowledge
          </AdminActionButton>
        ) : null}
        {status === "REQUESTED" || status === "ACKNOWLEDGED" ? (
          <>
            <AdminActionButton
              disabled={isPending}
              onClick={() => run("RECONCILE")}
            >
              Mark reconciled
            </AdminActionButton>
            <AdminActionButton
              disabled={isPending}
              tone="danger"
              onClick={() => run("REJECT")}
            >
              Reject
            </AdminActionButton>
          </>
        ) : null}
        {status === "RECONCILED" ? (
          <AdminActionButton disabled={isPending} onClick={() => run("COMPLETE")}>
            Complete
          </AdminActionButton>
        ) : null}
      </div>
      {error ? <p className="text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
