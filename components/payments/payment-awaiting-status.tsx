"use client";

import { useEffect, useState, useTransition } from "react";
import { readSamplePaymentStatus } from "@/actions/sample-payments";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function usePaymentConfirmationPoll(isAwaitingPayment: boolean, sampleCheckoutId?: string | null) {
  const router = useRouter();
  const [sampleStatus, setSampleStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let busy = false;
    let complete = false;
    const startedAt = Date.now();
    async function refresh() {
      if (busy || complete || Date.now() - startedAt > 30 * 60_000) return;
      if (!sampleCheckoutId) { router.refresh(); return; }
      busy = true;
      try {
        const result = await readSamplePaymentStatus(sampleCheckoutId);
        if (!active || !result) return;
        setSampleStatus(result.status);
        if (result.status === "SUCCEEDED" || result.status === "CANCELLED") complete = true;
        router.refresh();
      } catch { /* A later poll or manual refresh can recover a transient failure. */ }
      finally { busy = false; }
    }
    // Cross-tab messages are only invalidation hints; the server remains authoritative.
    function onStorage(event: StorageEvent) {
      if (event.key === "itrader:payment-update") void refresh();
    }
    window.addEventListener("storage", onStorage);
    const intervalId = isAwaitingPayment ? window.setInterval(() => { void refresh(); }, sampleCheckoutId ? 2000 : 5000) : undefined;

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("storage", onStorage);
    };
  }, [isAwaitingPayment, router, sampleCheckoutId]);
  return sampleStatus;
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
  const sampleStatus = usePaymentConfirmationPoll(isAwaitingPayment, sampleCheckoutId);

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
