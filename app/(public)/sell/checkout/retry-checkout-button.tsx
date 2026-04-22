"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  payForListing,
  simulateDemoListingPaymentOutcome,
} from "@/actions/payments";
import { submitListingForReview } from "@/actions/listings";
import { Button } from "@/components/ui/button";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";

interface Props {
  listingId: string;
  flow: "private" | "dealer";
}

export function RetryCheckoutButton({ listingId, flow }: Props) {
  const router = useRouter();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);

  function handleRetry() {
    setError(null);
    setNotice(null);
    setDemoOutcomeError(null);
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
        if (isRippleDemoCheckoutUrl(payResult.data.checkoutUrl)) {
          setNotice(
            "Demo checkout is ready in the modal below. Use the temporary outcome buttons after previewing the hosted tab."
          );
        } else {
          setNotice(
            "Hosted checkout reopened in a new tab. Keep this itrader tab open while payment completes."
          );
          router.refresh();
        }
        return;
      }

      router.push(`/sell/success?listing=${listingId}&flow=${flow}&payment=skipped`);
    });
  }

  function handleSimulatedDemoOutcome(outcome: "success" | "declined") {
    setDemoOutcomeError(null);
    startSimulatingDemoOutcome(async () => {
      const result = await simulateDemoListingPaymentOutcome({
        listingId,
        flow,
        outcome,
      });

      if (result.error) {
        setDemoOutcomeError(
          typeof result.error === "string"
            ? result.error
            : "Could not simulate the demo payment outcome."
        );
        return;
      }

      setDemoDialogOpen(false);

      if (result.data?.nextUrl) {
        router.push(result.data.nextUrl);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleRetry} loading={isPending}>
        Open payment in new tab
      </Button>
      {notice ? <p className="text-sm text-text-secondary">{notice}</p> : null}
      {error ? <p className="text-sm text-text-error">{error}</p> : null}

      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel="listing payment"
        demoOutcomeControls={{
          isPending: isSimulatingDemoOutcome,
          error: demoOutcomeError,
          onSimulateSuccess: () => handleSimulatedDemoOutcome("success"),
          onSimulateDeclined: () => handleSimulatedDemoOutcome("declined"),
        }}
      />
    </div>
  );
}
