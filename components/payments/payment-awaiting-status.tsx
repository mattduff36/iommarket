"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { readSamplePaymentStatus } from "@/actions/sample-payments";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  PAYMENT_RETURN_STORAGE_KEY,
  PAYMENT_UPDATE_STORAGE_KEY,
  acknowledgeCheckoutHandoff,
  parsePaymentReturnEvent,
  shouldAcknowledgeCheckoutHandoff,
  type PaymentReturnEvent,
} from "@/lib/payments/checkout-handoff";

export function usePaymentConfirmationPoll(
  isAwaitingPayment: boolean,
  sampleCheckoutId?: string | null,
  options?: { deferSuccessAck?: boolean },
) {
  const router = useRouter();
  const refreshRef = useRef(router.refresh);
  refreshRef.current = router.refresh;
  const [sampleStatus, setSampleStatus] = useState<string | null>(null);
  const [pendingSuccessEvent, setPendingSuccessEvent] = useState<PaymentReturnEvent | null>(null);
  const deferSuccessAck = options?.deferSuccessAck === true;

  useEffect(() => {
    let active = true;
    let busy = false;
    let complete = false;
    const startedAt = Date.now();

    async function refresh(event: PaymentReturnEvent | null = null) {
      if (busy || complete || Date.now() - startedAt > 30 * 60_000) return;
      if (event?.status === "success") setPendingSuccessEvent(event);
      const checkoutId = event?.sampleCheckoutId ?? sampleCheckoutId;
      if (!checkoutId && !event) {
        refreshRef.current();
        return;
      }
      busy = true;
      try {
        const sample = checkoutId ? await readSamplePaymentStatus(checkoutId) : null;
        if (!active) return;
        if (sample) {
          setSampleStatus(sample.status);
          if (sample.status === "SUCCEEDED" || sample.status === "CANCELLED") complete = true;
        }
        let link = null;
        if (event && !event.sampleCheckoutId) {
          const { readHostedCheckoutLink } = await import("@/actions/hosted-payment-return");
          link = await readHostedCheckoutLink();
          if (!active) return;
        }
        refreshRef.current();
        if (
          event &&
          !deferSuccessAck &&
          shouldAcknowledgeCheckoutHandoff({ event, sampleStatus: sample?.status, link })
        ) {
          acknowledgeCheckoutHandoff(event.id);
        }
      } catch {
        // A later poll or manual refresh can recover a transient failure.
      } finally {
        busy = false;
      }
    }

    // Cross-tab messages are only invalidation hints; the server remains authoritative.
    function onStorage(event: StorageEvent) {
      if (event.key === PAYMENT_RETURN_STORAGE_KEY) {
        void refresh(parsePaymentReturnEvent(event.newValue));
        return;
      }
      if (event.key === PAYMENT_UPDATE_STORAGE_KEY) void refresh();
    }
    window.addEventListener("storage", onStorage);
    const intervalId = isAwaitingPayment
      ? window.setInterval(() => { void refresh(); }, sampleCheckoutId ? 2000 : 5000)
      : undefined;

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("storage", onStorage);
    };
  }, [deferSuccessAck, isAwaitingPayment, sampleCheckoutId]);

  return { sampleStatus, pendingSuccessEvent };
}

export function PaymentAwaitingStatus({
  isAwaitingPayment,
  message,
  sampleCheckoutId,
}: {
  isAwaitingPayment: boolean;
  message: string;
  sampleCheckoutId?: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const { sampleStatus } = usePaymentConfirmationPoll(isAwaitingPayment, sampleCheckoutId);

  if (!isAwaitingPayment) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary" role="status">
        {sampleStatus === "FAILED" ? "The sample card was declined. Retry with another card in the checkout tab."
          : sampleStatus === "CANCELLED" ? "The sample checkout was cancelled."
          : sampleStatus === "SUCCEEDED" ? "Sample payment confirmed. Updating your account…" : message}
      </p>
      <Button
        type="button"
        variant="ghost"
        onClick={() => startTransition(() => router.refresh())}
        loading={isRefreshing}
      >
        Refresh payment status
      </Button>
    </div>
  );
}
