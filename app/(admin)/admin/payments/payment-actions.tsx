"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import {
  adminReconcileRipplePayment,
  adminRefundPayment,
} from "@/actions/admin/payments";

interface RefundButtonProps {
  paymentId: string;
  status: string;
  enabled: boolean;
  providerPortalUrl?: string | null;
}

export function RefundButton({
  paymentId,
  status,
  enabled,
  providerPortalUrl,
}: RefundButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState<
    "DUPLICATE" | "REQUESTED_BY_CUSTOMER" | "FRAUD" | "SERVICE_NOT_PROVIDED" | "OTHER"
  >("REQUESTED_BY_CUSTOMER");
  const [notes, setNotes] = useState("");

  if (status !== "SUCCEEDED") return null;
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
      const result = await adminRefundPayment({
        paymentId,
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
          Refund
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
          <AdminActionButton onClick={handleRefund} disabled={isPending} tone="danger">
            Confirm refund
          </AdminActionButton>
          <AdminActionButton onClick={() => setShowConfirm(false)} disabled={isPending}>
            Cancel
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}

export function ReconcileRippleButton({
  paymentId,
}: {
  paymentId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [providerPaymentId, setProviderPaymentId] = useState("");
  const [providerEventAt, setProviderEventAt] = useState("");
  const [notes, setNotes] = useState("");
  const [contractConfirmed, setContractConfirmed] = useState(false);
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await adminReconcileRipplePayment({
        paymentId,
        providerPaymentId,
        providerEventAt: new Date(providerEventAt),
        confirmedAmountCurrencyProduct: contractConfirmed as true,
        confirmedCurrentlyPaidAndNotRefunded: paidConfirmed as true,
        notes,
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Check every recovery field.",
        );
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <AdminActionButton onClick={() => setOpen(true)} tone="warning">
        Reconcile
      </AdminActionButton>
    );
  }

  return (
    <div className="flex w-80 min-w-0 max-w-[min(20rem,80vw)] flex-col gap-2 whitespace-normal rounded-lg border border-warning/30 bg-surface p-3 text-left">
      <p className="text-xs text-text-secondary">
        Enter evidence copied from Ripple. The browser return reference alone
        is not proof of payment.
      </p>
      <input
        aria-label="Ripple payment job reference"
        value={providerPaymentId}
        onChange={(event) => setProviderPaymentId(event.target.value)}
        placeholder="Payment job reference"
        inputMode="numeric"
        className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <input
        aria-label="Ripple payment time"
        type="datetime-local"
        value={providerEventAt}
        onChange={(event) => setProviderEventAt(event.target.value)}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-xs"
      />
      <textarea
        aria-label="Reconciliation notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Portal evidence and reason for manual recovery"
        className="min-h-16 w-full min-w-0 rounded-md border border-border bg-surface p-2 text-xs"
      />
      <label className="flex min-w-0 items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={contractConfirmed}
          onChange={(event) => setContractConfirmed(event.target.checked)}
          className="mt-0.5 shrink-0"
        />
        Amount, GBP currency, product, listing and merchant reference match.
      </label>
      <label className="flex min-w-0 items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={paidConfirmed}
          onChange={(event) => setPaidConfirmed(event.target.checked)}
          className="mt-0.5 shrink-0"
        />
        Ripple currently shows paid and not refunded.
      </label>
      <AdminActionBar className="w-full min-w-0">
        <AdminActionButton
          onClick={submit}
          disabled={
            isPending ||
            !providerPaymentId ||
            !providerEventAt ||
            !notes.trim() ||
            !contractConfirmed ||
            !paidConfirmed
          }
          tone="warning"
        >
          Confirm recovery
        </AdminActionButton>
        <AdminActionButton onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </AdminActionButton>
      </AdminActionBar>
      {error ? <p className="text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
