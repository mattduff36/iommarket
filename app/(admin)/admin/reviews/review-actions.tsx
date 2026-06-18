"use client";

import { useState, useTransition } from "react";
import { moderateDealerReview } from "@/actions/dealer-reviews";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";

interface Props {
  reviewId: string;
  currentStatus: "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN";
  currentAdminNotes?: string | null;
}

export function ReviewActions({ reviewId, currentStatus, currentAdminNotes }: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [adminNotes, setAdminNotes] = useState(currentAdminNotes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await moderateDealerReview({
        reviewId,
        status,
        adminNotes: adminNotes || undefined,
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to save moderation changes."
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
            setStatus(
              event.target.value as "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN"
            )
          }
          aria-label="Review status"
        >
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="HIDDEN">HIDDEN</option>
        </AdminActionSelect>
        <AdminActionButton disabled={isPending} onClick={save} tone="primary">
          Save
        </AdminActionButton>
      </div>
      <AdminActionTextarea
        rows={2}
        value={adminNotes}
        onChange={(event) => setAdminNotes(event.target.value)}
        placeholder="Admin notes"
        className="mt-2"
      />
      {error ? <p className="mt-2 text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
