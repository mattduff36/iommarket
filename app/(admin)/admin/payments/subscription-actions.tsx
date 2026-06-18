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
      const result = await adminCancelSubscription({ subscriptionId, immediately });
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
      const result = await adminRefundSubscriptionPayment({ subscriptionId });
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
          <span className="px-1 text-xs text-text-error">Refund?</span>
          <AdminActionButton
            onClick={handleRefund}
            disabled={isPending}
            tone="danger"
          >
            Yes
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
