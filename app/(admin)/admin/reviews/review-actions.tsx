"use client";

import { useState, useTransition } from "react";
import { moderateDealerReview } from "@/actions/dealer-reviews";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-2">
      <select
        className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
        value={status}
        onChange={(event) =>
          setStatus(
            event.target.value as "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN"
          )
        }
      >
        <option value="PENDING">PENDING</option>
        <option value="APPROVED">APPROVED</option>
        <option value="REJECTED">REJECTED</option>
        <option value="HIDDEN">HIDDEN</option>
      </select>
      <textarea
        rows={2}
        value={adminNotes}
        onChange={(event) => setAdminNotes(event.target.value)}
        placeholder="Admin notes"
        className="w-full rounded-md border border-border bg-surface p-2 text-xs"
      />
      {error ? <p className="text-xs text-text-error">{error}</p> : null}
      <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={save}>
        Save
      </Button>
    </div>
  );
}
