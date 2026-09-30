"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { confirmHostedListingPayment } from "@/actions/hosted-payment-return";
import { Button } from "@/components/ui/button";

export function HostedPaymentConfirmation({ paymentJobRef }: { paymentJobRef: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof confirmHostedListingPayment>>>({ status: "waiting" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    function check() {
      startTransition(async () => {
        let next: Awaited<ReturnType<typeof confirmHostedListingPayment>>;
        try {
          next = await confirmHostedListingPayment(paymentJobRef);
        } catch {
          next = { status: "waiting" };
        }
        if (stopped) return;
        attempts += 1;
        if (next.status === "waiting" && attempts >= 40) next = { status: "review" };
        setResult(next);
        if (next.status === "confirmed") {
          try {
            // The original checkout tab only refreshes its server-backed status.
            window.localStorage.setItem("iomarket-payment-return", JSON.stringify({
              status: "success", context: next.checkoutType === "dealer_subscription" ? "dealer" : "listing", listingId: next.listingId, at: Date.now(),
            }));
          } catch {
            // Storage may be unavailable; the explicit continuation still works.
          }
        } else if (next.status === "waiting") {
          timer = setTimeout(check, 3000);
        }
      });
    }
    check();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [paymentJobRef]);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface/60 p-4" role="status" aria-live="polite">
      {result.status === "confirmed" && result.checkoutType === "dealer_subscription" ? <>
        <h2 className="text-lg font-semibold">Your dealer subscription is confirmed</h2>
        <p className="text-sm text-text-secondary">Your payment has been linked to your dealer account. Your subscription is ready to use.</p>
        <Button asChild><Link href="/account">Continue to my account</Link></Button>
      </> : result.status === "confirmed" && result.checkoutType === "featured_upgrade" && result.listingId ? <>
        <h2 className="text-lg font-semibold">Your featured upgrade payment is confirmed</h2>
        <p className="text-sm text-text-secondary">Your payment has been linked to your listing. Continue to check its featured status.</p>
        <Button asChild><Link href="/account/listings">Continue to my listings</Link></Button>
      </> : result.status === "confirmed" && result.listingId ? <>
        <h2 className="text-lg font-semibold">Your listing payment is confirmed</h2>
        <p className="text-sm text-text-secondary">Your payment has been linked to your listing. Continue to see its status and any remaining steps.</p>
        <Button asChild><Link href={`/sell/checkout?listing=${encodeURIComponent(result.listingId)}`}>Continue to my listing</Link></Button>
      </> : result.status === "waiting" ? <>
        <h2 className="text-lg font-semibold">Confirming your payment</h2>
        <p className="text-sm text-text-secondary">We’re checking your payment confirmation. This can take a moment. Please don’t pay again.</p>
      </> : result.status === "sign-in" ? <>
        <h2 className="text-lg font-semibold">Sign in to finish checking your payment</h2>
        <p className="text-sm text-text-secondary">Use the account you started checkout with, then return to this page. Please don’t pay again.</p>
        <Button asChild><Link href="/sign-in">Sign in</Link></Button>
      </> : <>
        <h2 className="text-lg font-semibold">Your payment needs a review</h2>
        <p className="text-sm text-text-secondary">We couldn’t automatically link this payment. If you paid, please don’t pay again—our team can check it for you.</p>
        <Button asChild><Link href="/contact">Get help with my payment</Link></Button>
      </>}
    </div>
  );
}
