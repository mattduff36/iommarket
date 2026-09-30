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
  usePaymentConfirmationPoll(isAwaitingPayment || viewState === "failed");
  const reviewEmail = `mailto:hello@itrader.im?subject=${encodeURIComponent("Please check my listing payment")}&body=${encodeURIComponent(
    `Please check my Ripple payment for listing ${listingId}.\n\nRipple transaction reference: \nPayment date and time: \nEmail used at checkout: \nCurrent payment status in Ripple (paid or refunded): \n\nI understand this needs admin review before my listing payment can be confirmed.`,
  )}`;

  useEffect(() => {
    if (viewState !== "submitted" && viewState !== "paid") return;
    router.replace(
      `/sell/success?listing=${listingId}&flow=${flow}&payment=paid`,
    );
  }, [flow, listingId, router, viewState]);

  return (
    <div className="space-y-2">
      {viewState === "review" ? (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm text-text-secondary">
            Email us your Ripple transaction reference, the email you used at
            checkout, and when you paid. Let us know if the payment was refunded.
            We will check Ripple before confirming the payment for this listing.
          </p>
          <Button asChild>
            <a href={reviewEmail}>Email payment support</a>
          </Button>
          <p className="text-xs text-text-tertiary">
            This opens your email app. Sending the email does not confirm payment
            or charge you again. You do not need to keep this page open during
            review; return to this saved listing to check its status.
          </p>
        </div>
      ) : null}
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
          seconds while your hosted checkout is open. Complete the confirmation
          step when checkout returns you to itrader.
        </p>
      ) : null}
    </div>
  );
}
