"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readHostedCheckoutLink } from "@/actions/hosted-payment-return";
import { useCheckoutWindowHandoff } from "@/components/payments/checkout-window-handoff";
import { Button } from "@/components/ui/button";
import {
  createPaymentReturnEvent,
  publishCheckoutHandoff,
  type HostedCheckoutLink,
  type PaymentReturnContext,
  type PaymentReturnEvent,
} from "@/lib/payments/checkout-handoff";

interface PaymentReturnActionsProps {
  returnHref: string;
  status: "success" | "cancel";
  context: PaymentReturnContext;
  listingId?: string;
}

const CONFIRMATION_ATTEMPTS = 15;
const CONFIRMATION_INTERVAL_MS = 2_000;

export function PaymentReturnActions({
  returnHref,
  status,
  context,
  listingId,
}: PaymentReturnActionsProps) {
  const [link, setLink] = useState<HostedCheckoutLink | null>(status === "success" ? null : { status: "review" });
  const [handoffEvent, setHandoffEvent] = useState<PaymentReturnEvent | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const showReturnFallback = useCheckoutWindowHandoff(handoffEvent);

  useEffect(() => {
    if (status !== "success") {
      publishCheckoutHandoff(createPaymentReturnEvent({
        status: "cancel",
        context,
        listingId,
      }));
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    async function poll() {
      let next: HostedCheckoutLink;
      try {
        next = await readHostedCheckoutLink();
      } catch {
        next = { status: "waiting" };
      }
      if (stopped) return;
      attempts += 1;
      setLink(next);
      if (next.status === "confirmed") {
        setHandoffEvent((current) => current ?? createPaymentReturnEvent({
          status: "success",
          context: next.context ?? context,
          listingId: next.listingId ?? listingId,
        }));
        return;
      }
      if (next.status === "failed") {
        publishCheckoutHandoff(createPaymentReturnEvent({
          status: "failed",
          context: next.context ?? context,
          listingId: next.listingId ?? listingId,
        }));
        return;
      }
      if (next.status === "waiting" && attempts < CONFIRMATION_ATTEMPTS) {
        timer = setTimeout(() => { void poll(); }, CONFIRMATION_INTERVAL_MS);
        return;
      }
      setGaveUp(true);
    }

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [context, listingId, status]);

  function handleCloseTab() {
    window.close();
  }

  const confirmed = link?.status === "confirmed";
  const failed = link?.status === "failed";
  const waiting = status === "success" && !confirmed && !failed && !gaveUp;
  const detail = confirmed && !showReturnFallback
    ? "Your payment is linked. Returning to your original itrader tab…"
    : confirmed
      ? "Your payment is linked. This tab could not close automatically, so use the buttons below to return."
      : failed
        ? "This payment was not completed. Return to itrader to retry. Your saved listing is still there."
        : waiting
          ? "We are checking that this payment is linked. Please don’t pay again."
          : status === "cancel"
            ? "You can return to itrader and try again when you are ready."
            : "We could not confirm this payment from the return page. If you paid, don’t pay again—return to itrader and check the listing.";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary" role="status">{detail}</p>
      {showReturnFallback || !confirmed ? (
        <>
          <Button asChild>
            <Link href={returnHref}>Return to itrader</Link>
          </Button>
          <Button variant="ghost" onClick={handleCloseTab}>
            Close this tab
          </Button>
        </>
      ) : null}
    </div>
  );
}
