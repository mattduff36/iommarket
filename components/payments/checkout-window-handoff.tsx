"use client";

import { useEffect, useState } from "react";
import {
  PAYMENT_RETURN_ACK_STORAGE_KEY,
  PAYMENT_RETURN_ACK_TIMEOUT_MS,
  hasCheckoutHandoffAck,
  publishCheckoutHandoff,
  type PaymentReturnEvent,
} from "@/lib/payments/checkout-handoff";

export function useCheckoutWindowHandoff(event: PaymentReturnEvent | null) {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!event || event.status !== "success") return;
    const handoffEvent = event;
    let stopped = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    function showManualReturn() {
      if (!stopped) setShowFallback(true);
    }

    function finishClose() {
      if (finished || stopped) return;
      finished = true;
      if (timer) clearTimeout(timer);
      window.close();
      timer = setTimeout(showManualReturn, 300);
    }

    function checkAck() {
      if (stopped || finished) return;
      if (hasCheckoutHandoffAck(handoffEvent.id)) {
        finishClose();
        return;
      }
      if (Date.now() - startedAt >= PAYMENT_RETURN_ACK_TIMEOUT_MS) {
        showManualReturn();
        return;
      }
      timer = setTimeout(checkAck, 200);
    }

    function onStorage(storageEvent: StorageEvent) {
      if (storageEvent.key === PAYMENT_RETURN_ACK_STORAGE_KEY && storageEvent.newValue === handoffEvent.id) {
        finishClose();
      }
    }

    if (!publishCheckoutHandoff(handoffEvent)) {
      showManualReturn();
      return;
    }

    window.addEventListener("storage", onStorage);
    checkAck();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [event]);

  return showFallback;
}
