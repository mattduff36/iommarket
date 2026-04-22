"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { payForListing } from "@/actions/payments";
import { submitListingForReview } from "@/actions/listings";
import { Button } from "@/components/ui/button";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";

interface Props {
  listingId: string;
  flow: "private" | "dealer";
}

export function RetryCheckoutButton({ listingId, flow }: Props) {
  const router = useRouter();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const payResult = await payForListing(listingId);
      if (payResult.error) {
        setError(
          typeof payResult.error === "string"
            ? payResult.error
            : "Could not restart checkout. Please try again."
        );
        return;
      }

      if (payResult.data?.skippedPayment) {
        const reviewResult = await submitListingForReview(listingId);
        if (reviewResult?.error) {
          setError(
            typeof reviewResult.error === "string"
              ? reviewResult.error
              : "Could not submit your listing for review."
          );
          return;
        }
      }

      if (payResult.data?.checkoutUrl) {
        openCheckout(payResult.data.checkoutUrl);
        return;
      }

      router.push(`/sell/success?listing=${listingId}&flow=${flow}&payment=skipped`);
    });
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleRetry} loading={isPending}>
        Retry checkout
      </Button>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}

      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel="listing payment"
      />
    </div>
  );
}
