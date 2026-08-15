"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import {
  adminCancelSubscription,
  adminRefundSubscriptionPayment,
} from "@/actions/admin/payments";

interface CancelSubButtonProps {
  subscriptionId: string;
  status: string;
  enabled: boolean;
  providerPortalUrl?: string | null;
}

export function CancelSubButton({
  subscriptionId,
  status,
  enabled,
  providerPortalUrl,
}: CancelSubButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState<
    "REQUESTED_BY_CUSTOMER" | "FRAUD" | "SERVICE_NOT_PROVIDED" | "OTHER"
  >("REQUESTED_BY_CUSTOMER");
  const [notes, setNotes] = useState("");

  if (status === "CANCELLED") return null;
  if (!enabled) {
    return providerPortalUrl ? (
      <a
        href={providerPortalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-secondary underline"
      >
        Manage in Ripple
      </a>
    ) : (
      <span className="text-xs text-text-tertiary">Manage in Ripple</span>
    );
  }

  function handleCancel(immediately: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await adminCancelSubscription({
        subscriptionId,
        immediately,
        reason,
        notes: notes.trim() || undefined,
      });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowConfirm(false);
  }

  return (
    <div className="space-y-2">
      {!showConfirm ? (
        <AdminActionButton
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          tone="danger"
        >
          Cancel
        </AdminActionButton>
      ) : (
        <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
          <select
            aria-label="Cancellation reason"
            value={reason}
            onChange={(event) =>
              setReason(
                event.target.value as
                  | "REQUESTED_BY_CUSTOMER"
                  | "FRAUD"
                  | "SERVICE_NOT_PROVIDED"
                  | "OTHER",
              )
            }
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="REQUESTED_BY_CUSTOMER">Customer request</option>
            <option value="FRAUD">Fraud</option>
            <option value="SERVICE_NOT_PROVIDED">Service not provided</option>
            <option value="OTHER">Other</option>
          </select>
          {reason === "OTHER" ? (
            <input
              aria-label="Cancellation notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Notes required"
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            />
          ) : null}
          <AdminActionButton onClick={() => handleCancel(false)} disabled={isPending}>
            At period end
          </AdminActionButton>
          <AdminActionButton
            onClick={() => handleCancel(true)}
            disabled={isPending}
            tone="danger"
          >
            Immediately
          </AdminActionButton>
          <AdminActionButton onClick={() => setShowConfirm(false)} disabled={isPending}>
            Back
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}

interface RefundSubPaymentButtonProps {
  subscriptionId: string;
  enabled: boolean;
  providerPortalUrl?: string | null;
}

export function RefundSubPaymentButton({
  subscriptionId,
  enabled,
  providerPortalUrl,
}: RefundSubPaymentButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState<
    "DUPLICATE" | "REQUESTED_BY_CUSTOMER" | "FRAUD" | "SERVICE_NOT_PROVIDED" | "OTHER"
  >("REQUESTED_BY_CUSTOMER");
  const [notes, setNotes] = useState("");

  if (!enabled) {
    return providerPortalUrl ? (
      <a
        href={providerPortalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-secondary underline"
      >
        Manage in Ripple
      </a>
    ) : (
      <span className="text-xs text-text-tertiary">Manage in Ripple</span>
    );
  }

  function handleRefund() {
    setError(null);
    startTransition(async () => {
      const result = await adminRefundSubscriptionPayment({
        subscriptionId,
        reason,
        notes: notes.trim() || undefined,
      });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowConfirm(false);
  }

  return (
    <div className="space-y-2">
      {!showConfirm ? (
        <AdminActionButton
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          tone="danger"
        >
          Refund latest payment
        </AdminActionButton>
      ) : (
        <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
          <select
            aria-label="Refund reason"
            value={reason}
            onChange={(event) =>
              setReason(
                event.target.value as
                  | "DUPLICATE"
                  | "REQUESTED_BY_CUSTOMER"
                  | "FRAUD"
                  | "SERVICE_NOT_PROVIDED"
                  | "OTHER",
              )
            }
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="REQUESTED_BY_CUSTOMER">Customer request</option>
            <option value="DUPLICATE">Duplicate</option>
            <option value="FRAUD">Fraud</option>
            <option value="SERVICE_NOT_PROVIDED">Service not provided</option>
            <option value="OTHER">Other</option>
          </select>
          {reason === "OTHER" ? (
            <input
              aria-label="Refund notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Notes required"
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
            />
          ) : null}
          <AdminActionButton
            onClick={handleRefund}
            disabled={isPending}
            tone="danger"
          >
            Confirm refund
          </AdminActionButton>
          <AdminActionButton
            onClick={() => setShowConfirm(false)}
            disabled={isPending}
          >
            No
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
