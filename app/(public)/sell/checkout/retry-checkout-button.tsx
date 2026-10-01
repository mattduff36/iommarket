"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  payForListing,
  simulateDemoListingPaymentOutcome,
  upgradeFeatured,
} from "@/actions/payments";
import { submitListingForReview } from "@/actions/listings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import { FeaturedCheckoutOffer } from "../create-listing-featured-offer";
import {
  FEATURED_AFTER_SUBMIT_MESSAGE,
  buildPayForListingInput,
  featuredPurchaseFailure,
  readListingPaymentResult,
  shouldStartSeparateFeaturedCheckout,
} from "../featured-checkout";

interface Props {
  listingId: string;
  flow: "private" | "dealer";
  listingFeePence?: number;
  featuredUpgradePricePence?: number;
  listingFeeDue?: boolean;
  featuredAlreadyPurchased?: boolean;
}

export function RetryCheckoutButton({
  listingId,
  flow,
  listingFeePence,
  featuredUpgradePricePence,
  listingFeeDue = false,
  featuredAlreadyPurchased = false,
}: Props) {
  const router = useRouter();
  const submitLock = useRef(false);
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);
  const [privateSellerTermsAccepted, setPrivateSellerTermsAccepted] =
    useState(false);
  const [includeFeatured, setIncludeFeatured] = useState(false);
  const featuredOffer =
    !featuredAlreadyPurchased &&
    typeof listingFeePence === "number" &&
    typeof featuredUpgradePricePence === "number"
      ? { listingFeePence, featuredUpgradePricePence }
      : null;
  const chooseFeatured = includeFeatured && !featuredAlreadyPurchased;

  function handleRetry() {
    if (submitLock.current) return;
    submitLock.current = true;
    setError(null);
    setNotice(null);
    setDemoOutcomeError(null);
    startTransition(async () => {
      try {
        const payResult = await payForListing(
          buildPayForListingInput({
            listingId,
            privateSellerTermsAccepted:
              flow === "private" && privateSellerTermsAccepted ? true : undefined,
            includeFeatured: chooseFeatured,
            listingFeeDue,
          }),
        );
        if (payResult.error) {
          setError(
            typeof payResult.error === "string"
              ? payResult.error
              : "Could not restart checkout. Please try again.",
          );
          return;
        }

        const listingSubmitted = readListingPaymentResult(payResult.data).listingSubmitted;
        if (payResult.data?.skippedPayment && !listingSubmitted) {
          const reviewResult = await submitListingForReview({
            listingId,
            privateSellerTermsAccepted:
              flow === "private" && privateSellerTermsAccepted ? true : undefined,
          });
          if (reviewResult?.error) {
            setError(
              typeof reviewResult.error === "string"
                ? reviewResult.error
                : "Could not submit your listing for review.",
            );
            return;
          }
        }

        if (
          shouldStartSeparateFeaturedCheckout({
            includeFeatured: chooseFeatured,
            listingFeeDue,
            skippedPayment: Boolean(payResult.data?.skippedPayment),
          })
        ) {
          try {
            const featuredResult = await upgradeFeatured(listingId);
            if (featuredResult.error || !featuredResult.data?.checkoutUrl) {
              setError(featuredPurchaseFailure(featuredResult.error));
              return;
            }
            const opened = openCheckout(featuredResult.data.checkoutUrl);
            if (isRippleDemoCheckoutUrl(featuredResult.data.checkoutUrl)) {
              setNotice(
                "Demo checkout is ready in the modal below. Your listing is already submitted.",
              );
            } else if (opened === false) {
              setNotice("Checkout is ready in the payment dialog below. Your listing is already submitted.");
            } else {
              setNotice(
                "Featured checkout opened in a new tab. Your listing is already submitted. Keep this itrader tab open while payment completes.",
              );
              router.refresh();
            }
          } catch {
            setError(FEATURED_AFTER_SUBMIT_MESSAGE);
          }
          return;
        }

        if (payResult.data?.checkoutUrl) {
          const opened = openCheckout(payResult.data.checkoutUrl);
          if (isRippleDemoCheckoutUrl(payResult.data.checkoutUrl)) {
            setNotice(
              "Demo checkout is ready in the modal below. Use the temporary outcome buttons after previewing the hosted tab.",
            );
          } else if (opened === false) {
            setNotice("Checkout is ready in the payment dialog below.");
          } else {
            setNotice(
              "Hosted checkout reopened in a new tab. Keep this itrader tab open while payment completes.",
            );
            router.refresh();
          }
          return;
        }

        router.replace(`/sell/success?listing=${listingId}&flow=${flow}&payment=skipped`);
      } catch {
        setError(
          "We couldn't confirm the checkout request. Check this listing's payment status before retrying if a checkout may have opened or payment may have completed.",
        );
      } finally {
        submitLock.current = false;
      }
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
        router.replace(result.data.nextUrl);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {featuredAlreadyPurchased ? (
        <FeaturedCheckoutOffer
          listingFeePence={listingFeePence ?? 0}
          featuredUpgradePricePence={featuredUpgradePricePence ?? 0}
          listingFeeDue={listingFeeDue}
          includeFeatured={false}
          alreadyPurchased
          onIncludeFeaturedChange={() => undefined}
        />
      ) : null}
      {featuredOffer ? (
        <FeaturedCheckoutOffer
          listingFeePence={featuredOffer.listingFeePence}
          featuredUpgradePricePence={featuredOffer.featuredUpgradePricePence}
          listingFeeDue={listingFeeDue}
          includeFeatured={includeFeatured}
          onIncludeFeaturedChange={setIncludeFeatured}
        />
      ) : null}
      {flow === "private" ? (
        <div className="rounded-md border border-border p-3">
          <Checkbox
            checked={privateSellerTermsAccepted}
            onCheckedChange={(checked) =>
              setPrivateSellerTermsAccepted(checked === true)
            }
            label={
              <span className="leading-5">
                I expressly accept the current{" "}
                <Link
                  href="/private-seller-terms"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Private Seller Terms
                </Link>
                ,{" "}
                <Link
                  href="/acceptable-use"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Acceptable Use Policy
                </Link>
                , and{" "}
                <Link
                  href="/refunds"
                  target="_blank"
                  className="text-neon-blue-400 underline"
                >
                  Refund Policy
                </Link>
                .
              </span>
            }
          />
        </div>
      ) : null}
      <Button
        onClick={handleRetry}
        loading={isPending}
        disabled={flow === "private" && !privateSellerTermsAccepted}
      >
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
