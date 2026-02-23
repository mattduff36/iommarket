"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminRefundPayment } from "@/actions/admin/payments";

interface RefundButtonProps {
  paymentId: string;
  status: string;
}

export function RefundButton({ paymentId, status }: RefundButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (status !== "SUCCEEDED") return null;

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
    <div className="flex items-center gap-1">
      {!showConfirm ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          className="text-xs text-neon-red-400"
        >
          Refund
        </Button>
      ) : (
        <>
          <span className="text-xs text-text-error">Refund?</span>
          <Button size="sm" variant="ghost" onClick={handleRefund} disabled={isPending} className="text-xs text-neon-red-400">
            Yes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)} disabled={isPending} className="text-xs">
            No
          </Button>
        </>
      )}
      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
