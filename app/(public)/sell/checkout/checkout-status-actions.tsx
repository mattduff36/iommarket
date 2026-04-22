"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface CheckoutStatusActionsProps {
  isAwaitingPayment: boolean;
}

export function CheckoutStatusActions({
  isAwaitingPayment,
}: CheckoutStatusActionsProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  useEffect(() => {
    if (!isAwaitingPayment) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 5000);

    function handleStorage(event: StorageEvent) {
      if (event.key !== "iomarket-payment-return") {
        return;
      }

      router.refresh();
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", handleStorage);
    };
  }, [isAwaitingPayment, router]);

  return (
    <div className="space-y-2">
      <Button variant="ghost" onClick={handleRefresh} loading={isRefreshing}>
        Refresh payment status
      </Button>
      {isAwaitingPayment ? (
        <p className="text-xs text-text-tertiary">
          This page checks for payment confirmation automatically every few
          seconds while your hosted checkout is open.
        </p>
      ) : null}
    </div>
  );
}
