"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePaymentConfirmationPoll } from "@/components/payments/payment-awaiting-status";

interface CheckoutStatusActionsProps {
  isAwaitingPayment: boolean;
}

export function CheckoutStatusActions({
  isAwaitingPayment,
}: CheckoutStatusActionsProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  usePaymentConfirmationPoll(isAwaitingPayment);

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        onClick={() => startTransition(() => router.refresh())}
        loading={isRefreshing}
      >
        Refresh payment status
      </Button>
      {isAwaitingPayment ? (
        <p className="text-xs text-text-tertiary">
          This page checks for payment confirmation automatically every few
          seconds while your hosted checkout is open. Ripple does not redirect
          back here after payment.
        </p>
      ) : null}
    </div>
  );
}
