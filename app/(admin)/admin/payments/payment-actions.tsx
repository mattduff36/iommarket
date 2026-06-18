"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { adminRefundPayment } from "@/actions/admin/payments";

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
      const result = await adminRefundPayment({ paymentId });
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
          <span className="px-1 text-xs text-text-error">Refund?</span>
          <AdminActionButton onClick={handleRefund} disabled={isPending} tone="danger">
            Yes
          </AdminActionButton>
          <AdminActionButton onClick={() => setShowConfirm(false)} disabled={isPending}>
            No
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
