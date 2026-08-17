"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  decideDealerReviewDispute,
  moderateDealerReviewResponse,
} from "@/actions/dealer-reviews";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";

const REASONS = ["POLICY", "ABUSE", "SPAM", "OFF_TOPIC", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  return "The record changed or could not be saved. Refresh and try again.";
}

export function ResponseRevisionActions({
  revisionId,
  revisionVersion,
  responseVersion,
}: {
  revisionId: string;
  revisionVersion: number;
  responseVersion: number;
}) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState<Reason>("POLICY");
  const [adminNotes, setAdminNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await moderateDealerReviewResponse({
        revisionId,
        expectedVersion: revisionVersion,
        expectedResponseVersion: responseVersion,
        decision,
        reasonCode: decision === "REJECTED" ? reasonCode : undefined,
        adminNotes: adminNotes || undefined,
      });
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-canvas/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <AdminActionSelect
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value as Reason)}
          aria-label="Response rejection reason"
          disabled={isPending}
        >
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </AdminActionSelect>
        <AdminActionButton
          disabled={isPending}
          onClick={() => decide("APPROVED")}
          tone="success"
        >
          Approve response
        </AdminActionButton>
        <AdminActionButton
          disabled={isPending}
          onClick={() => decide("REJECTED")}
          tone="danger"
        >
          Reject response
        </AdminActionButton>
      </div>
      <AdminActionTextarea
        rows={2}
        value={adminNotes}
        onChange={(event) => setAdminNotes(event.target.value)}
        placeholder="Internal moderation notes"
        className="mt-2"
        disabled={isPending}
      />
      {error ? (
        <p className="mt-2 text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReviewDisputeActions({
  disputeId,
  version,
}: {
  disputeId: string;
  version: number;
}) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState<Reason>("POLICY");
  const [adminNotes, setAdminNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "RESOLVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await decideDealerReviewDispute({
        disputeId,
        expectedVersion: version,
        decision,
        reasonCode,
        adminNotes: adminNotes || undefined,
      });
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-canvas/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <AdminActionSelect
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value as Reason)}
          aria-label="Dispute decision reason"
          disabled={isPending}
        >
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </AdminActionSelect>
        <AdminActionButton
          disabled={isPending}
          onClick={() => decide("RESOLVED")}
          tone="success"
        >
          Resolve dispute
        </AdminActionButton>
        <AdminActionButton
          disabled={isPending}
          onClick={() => decide("REJECTED")}
          tone="danger"
        >
          Reject dispute
        </AdminActionButton>
      </div>
      <AdminActionTextarea
        rows={2}
        value={adminNotes}
        onChange={(event) => setAdminNotes(event.target.value)}
        placeholder="Internal decision notes"
        className="mt-2"
        disabled={isPending}
      />
      {error ? (
        <p className="mt-2 text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
