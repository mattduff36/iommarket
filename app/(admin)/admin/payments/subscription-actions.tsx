"use client";

import { useMutationRecovery } from "@/lib/forms/use-mutation-recovery";

import { useRef, useState, useTransition } from "react";
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
  const recovery = useMutationRecovery();
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
      const result = await recovery.run(() => adminCancelSubscription({
        subscriptionId,
        immediately,
        reason,
        notes: notes.trim() || undefined,
      }));
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
          disabled={isPending || recovery.blocked}
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
          <AdminActionButton onClick={() => handleCancel(false)} disabled={isPending || recovery.blocked}>
            At period end
          </AdminActionButton>
          <AdminActionButton
            onClick={() => handleCancel(true)}
            disabled={isPending || recovery.blocked}
            tone="danger"
          >
            Immediately
          </AdminActionButton>
          <AdminActionButton onClick={() => setShowConfirm(false)} disabled={isPending || recovery.blocked}>
            Back
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p role="alert" className="text-xs text-text-error">{error}</p>}
      {recovery.blocked ? <a href="/admin/payments" className="block text-sm underline">Reload and check status</a> : null}
    </div>
  );
}

interface RefundChargeTarget {
  id: string;
  amount: number;
  currency: string;
  paymentReference: string;
}

interface RefundSubPaymentButtonProps {
  subscriptionId: string;
  charge: RefundChargeTarget | null;
  recordLocally?: boolean;
}

function formatRefundAmount(amount: number, currency: string) {
  const pounds = (amount / 100).toFixed(2);
  return currency.toLowerCase() === "gbp" ? `£${pounds}` : `${pounds} ${currency.toUpperCase()}`;
}

export function RefundSubPaymentButton({
  subscriptionId,
  charge,
  recordLocally = false,
}: RefundSubPaymentButtonProps) {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const [confirmedCharge, setConfirmedCharge] = useState<RefundChargeTarget | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const recovery = useMutationRecovery();
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState<
    "DUPLICATE" | "REQUESTED_BY_CUSTOMER" | "FRAUD" | "SERVICE_NOT_PROVIDED" | "OTHER"
  >("REQUESTED_BY_CUSTOMER");
  const [notes, setNotes] = useState("");

  if (!charge) {
    return <span className="text-xs text-text-tertiary">No unrefunded payment</span>;
  }

  function beginConfirm() {
    if (!charge) return;
    setConfirmedCharge((current) => current ?? charge);
    operationId.current ??= crypto.randomUUID();
    setShowConfirm(true);
  }

  function dismissConfirm() {
    if (isPending) return;
    operationId.current = null;
    setConfirmedCharge(null);
    setShowConfirm(false);
  }

  function handleRefund() {
    const target = confirmedCharge ?? charge;
    if (!target) return;
    const confirmedOperationId = operationId.current ?? crypto.randomUUID();
    operationId.current = confirmedOperationId;
    setError(null);
    startTransition(async () => {
      const result = await recovery.run(() => adminRefundSubscriptionPayment({
        subscriptionId,
        chargeId: target.id,
        operationId: confirmedOperationId,
        reason,
        notes: notes.trim() || undefined,
      }));
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
        return;
      }
      operationId.current = null;
      setConfirmedCharge(null);
      setShowConfirm(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {!showConfirm ? (
        <AdminActionButton
          onClick={beginConfirm}
          disabled={isPending || recovery.blocked}
          tone="danger"
        >
          {recordLocally ? "Record portal refund" : "Refund latest payment"}
        </AdminActionButton>
      ) : (
        <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
          <p className="w-full px-1 text-xs text-text-secondary">
            {recordLocally
              ? `Record the portal refund for ${(confirmedCharge ?? charge).paymentReference} (${formatRefundAmount((confirmedCharge ?? charge).amount, (confirmedCharge ?? charge).currency)}). This does not send a refund to Ripple.`
              : `Refund ${(confirmedCharge ?? charge).paymentReference} (${formatRefundAmount((confirmedCharge ?? charge).amount, (confirmedCharge ?? charge).currency)}).`}
          </p>
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
            disabled={isPending || recovery.blocked}
            tone="danger"
          >
            {recordLocally ? "Confirm record" : "Confirm refund"}
          </AdminActionButton>
          <AdminActionButton
            onClick={dismissConfirm}
            disabled={isPending || recovery.blocked}
          >
            No
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p role="alert" className="text-xs text-text-error">{error}</p>}
      {recovery.blocked ? <a href="/admin/payments" className="block text-sm underline">Reload and check status</a> : null}
    </div>
  );
}
