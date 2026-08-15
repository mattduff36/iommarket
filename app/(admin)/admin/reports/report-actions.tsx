"use client";

import { useState, useTransition } from "react";
import { takeDownListingFromReport, updateReportStatus } from "@/actions/admin";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";
import { ModerationReasonDialog } from "@/components/admin/moderation-reason-dialog";
import { LISTING_MODERATION_REASON_LABELS } from "@/lib/listings/moderation-reasons";

interface Props {
  reportId: string;
  currentStatus: "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED";
  currentAdminNotes?: string | null;
  listingStatus: string;
  expectedRevision: number;
}

const REASON_OPTIONS = Object.entries(LISTING_MODERATION_REASON_LABELS)
  .filter(([value]) => value !== "ACCOUNT_DISABLED")
  .map(([value, label]) => ({ value, label }));

export function ReportActions({
  reportId,
  currentStatus,
  currentAdminNotes,
  listingStatus,
  expectedRevision,
}: Props) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState(currentAdminNotes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showTakeDown, setShowTakeDown] = useState(false);

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
      {listingStatus === "LIVE" || listingStatus === "PENDING" || listingStatus === "APPROVED" ? (
        <AdminActionButton
          className="mt-2"
          tone="danger"
          disabled={isPending}
          onClick={() => setShowTakeDown(true)}
        >
          Take down and mark actioned
        </AdminActionButton>
      ) : null}
      {showTakeDown ? (
        <ModerationReasonDialog
          title="Take down listing and mark report actioned"
          confirmLabel="Take down"
          reasons={REASON_OPTIONS}
          pending={isPending}
          onCancel={() => setShowTakeDown(false)}
          onConfirm={({ reasonCode, notes: reasonNotes }) => {
            setError(null);
            startTransition(async () => {
              const result = await takeDownListingFromReport({
                reportId,
                expectedRevision,
                reasonCode: reasonCode as
                  | "FRAUD"
                  | "PROHIBITED"
                  | "MISLEADING"
                  | "DUPLICATE"
                  | "POLICY"
                  | "SAFETY"
                  | "OTHER",
                adminNotes: reasonNotes || notes || undefined,
              });
              if (result.error) {
                setError(
                  typeof result.error === "string"
                    ? result.error
                    : "Failed to take down listing.",
                );
              }
            });
          }}
        />
      ) : null}
      {error ? <p className="mt-2 text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
