"use client";

import { useState } from "react";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";

export function ModerationReasonDialog({
  title,
  confirmLabel,
  reasons,
  onConfirm,
  onCancel,
  pending,
}: {
  title: string;
  confirmLabel: string;
  reasons: Array<{ value: string; label: string }>;
  onConfirm: (input: { reasonCode: string; notes: string }) => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const [reasonCode, setReasonCode] = useState(reasons[0]?.value ?? "");
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
        onChange={(event) => setReasonCode(event.target.value)}
        aria-label="Reason"
      >
        {reasons.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </AdminActionSelect>
      <AdminActionTextarea
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (required for Other)"
      />
      <div className="flex gap-2">
        <AdminActionButton
          tone="danger"
          disabled={pending}
          onClick={() => onConfirm({ reasonCode, notes })}
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
