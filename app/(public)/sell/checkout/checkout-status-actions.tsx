"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePaymentConfirmationPoll } from "@/components/payments/payment-awaiting-status";
import type { CheckoutViewState } from "@/lib/payments/checkout-view";

interface CheckoutStatusActionsProps {
  listingId: string;
  flow: "private" | "dealer";
  viewState: CheckoutViewState;
  isAwaitingPayment: boolean;
}

export function CheckoutStatusActions({
  listingId,
  flow,
  viewState,
  isAwaitingPayment,
}: CheckoutStatusActionsProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  usePaymentConfirmationPoll(isAwaitingPayment);

  useEffect(() => {
    if (viewState !== "submitted" && viewState !== "paid") return;
    router.replace(
      `/sell/success?listing=${listingId}&flow=${flow}&payment=paid`,
    );
  }, [flow, listingId, router, viewState]);

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
