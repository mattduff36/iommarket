"use client";

import { useState } from "react";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";
import { MODERATION_TAXONOMY_VERSION } from "@/lib/listings/moderation-reasons";

interface ModerationReasonOption {
  value: string;
  label: string;
  subReasons: Array<{
    value: string;
    label: string;
    clauseRefs: readonly string[];
  }>;
}

export function ModerationReasonDialog({
  title,
  confirmLabel,
  reasons,
  onConfirm,
  onCancel,
  pending,
  initialReasonCode,
}: {
  title: string;
  confirmLabel: string;
  reasons: ModerationReasonOption[];
  onConfirm: (input: {
    reasonCode: string;
    moderationSubReason: string;
    moderationTaxonomyVersion: typeof MODERATION_TAXONOMY_VERSION;
    notes: string;
  }) => void;
  onCancel: () => void;
  pending?: boolean;
  initialReasonCode?: string | null;
}) {
  const initialReason =
    reasons.find((reason) => reason.value === initialReasonCode) ?? reasons[0];
  const [reasonCode, setReasonCode] = useState(initialReason?.value ?? "");
  const selectedReason = reasons.find((reason) => reason.value === reasonCode);
  const [moderationSubReason, setModerationSubReason] = useState(
    initialReason?.subReasons[0]?.value ?? "",
  );
  const selectedSubReason = selectedReason?.subReasons.find(
    (reason) => reason.value === moderationSubReason,
  );
  const [notes, setNotes] = useState("");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="mt-3 space-y-2 rounded-lg border border-border bg-canvas/40 p-3"
    >
      <p className="text-xs font-medium text-text-primary">{title}</p>
      <AdminActionSelect
        value={reasonCode}
        onChange={(event) => {
          const next = reasons.find(
            (reason) => reason.value === event.target.value,
          );
          setReasonCode(event.target.value);
          setModerationSubReason(next?.subReasons[0]?.value ?? "");
        }}
        aria-label="Reason category"
      >
        {reasons.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </AdminActionSelect>
      <AdminActionSelect
        value={moderationSubReason}
        onChange={(event) => setModerationSubReason(event.target.value)}
        aria-label="Specific moderation reason"
      >
        {selectedReason?.subReasons.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </AdminActionSelect>
      {selectedSubReason ? (
        <p className="text-xs text-text-secondary">
          Policy references: {selectedSubReason.clauseRefs.join(", ")}
        </p>
      ) : null}
      <AdminActionTextarea
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (required for Other)"
      />
      <div className="flex gap-2">
        <AdminActionButton
          tone="danger"
          onClick={() =>
            onConfirm({
              reasonCode,
              moderationSubReason,
              moderationTaxonomyVersion: MODERATION_TAXONOMY_VERSION,
              notes,
            })
          }
          disabled={pending || !reasonCode || !moderationSubReason}
        >
          {confirmLabel}
        </AdminActionButton>
        <AdminActionButton disabled={pending} onClick={onCancel}>
          Cancel
        </AdminActionButton>
      </div>
    </div>
  );
}
