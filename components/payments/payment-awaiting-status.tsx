"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function usePaymentConfirmationPoll(isAwaitingPayment: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!isAwaitingPayment) return undefined;

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAwaitingPayment, router]);
}

export function PaymentAwaitingStatus({
  isAwaitingPayment,
  message,
}: {
  isAwaitingPayment: boolean;
  message: string;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  usePaymentConfirmationPoll(isAwaitingPayment);

  if (!isAwaitingPayment) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary" role="status">
        {message}
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
