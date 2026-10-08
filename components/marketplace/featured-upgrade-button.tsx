"use client";

import { useRef, useState, useTransition } from "react";
import { upgradeFeatured } from "@/actions/payments";
import { Button } from "@/components/ui/button";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { isUncertainActionResult, UNCERTAIN_CHECKOUT_MESSAGE } from "@/lib/forms/outcome-uncertainty";
import { Star } from "lucide-react";
import { formatGbpFromPence } from "@/lib/formatting/gbp";
import { PaymentAwaitingStatus } from "@/components/payments/payment-awaiting-status";

interface FeaturedUpgradeButtonProps {
  listingId: string;
  featuredUpgradePricePence: number;
  checkoutUnavailable?: boolean;
  pendingReview?: boolean;
  variant?: "card" | "inline";
}

export function FeaturedUpgradeButton({
  listingId,
  featuredUpgradePricePence,
  checkoutUnavailable = false,
  pendingReview = false,
  variant = "card",
}: FeaturedUpgradeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const submitLock = useRef(false);
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen, sampleCheckoutId } =
    useRippleDemoCheckout();
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [isAwaitingPayment, setIsAwaitingPayment] = useState(false);
  const pendingCopy = "This purchase activates after the listing is approved.";

  function handleUpgrade() {
    if (submitLock.current || checkoutUnavailable || uncertain) return;
    submitLock.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await upgradeFeatured(listingId);
        if (result.error) {
          setUncertain(isUncertainActionResult(result));
          setError(
            typeof result.error === "string"
              ? result.error
              : UNCERTAIN_CHECKOUT_MESSAGE,
          );
          return;
        }
        if (result.data?.checkoutUrl) {
          openCheckout(result.data.checkoutUrl);
          setIsAwaitingPayment(true);
        } else { setUncertain(true); setError(UNCERTAIN_CHECKOUT_MESSAGE); }
      } catch {
        setUncertain(true);
        setError(UNCERTAIN_CHECKOUT_MESSAGE);
      } finally {
        submitLock.current = false;
      }
    });
  }

  if (variant === "inline") {
    return (
      <div className="inline-flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUpgrade}
          disabled={checkoutUnavailable || uncertain}
          loading={isPending}
          aria-busy={isPending || undefined}
          className="text-premium-gold-400 hover:text-premium-gold-500"
          title="Upgrade to featured"
        >
          <Star className="h-3.5 w-3.5" />
          Feature for {formatGbpFromPence(featuredUpgradePricePence)}
        </Button>
        {pendingReview ? (
          <p className="text-xs text-text-secondary">{pendingCopy}</p>
        ) : null}
        {checkoutUnavailable && (
          <p className="text-xs text-text-secondary" role="note">
            New payments are disabled on preview.
          </p>
        )}
        {error && (
          <p className="text-xs text-text-error" role="alert">
            {error}
          </p>
        )}
        {uncertain ? <a href={`/listings/${listingId}`} className="text-text-trust underline">Check Featured status</a> : null}
      <PaymentAwaitingStatus sampleCheckoutId={sampleCheckoutId}
          isAwaitingPayment={isAwaitingPayment}
          message="Checkout is open in another tab. This page will update when the payment service confirms the featured upgrade."
        />
        <RippleDemoCheckoutDialog
          open={demoDialogOpen}
          onOpenChange={setDemoDialogOpen}
          checkoutUrl={demoCheckoutUrl}
          checkoutLabel="featured upgrade"
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-premium-gold-500/30 bg-premium-gold-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="text-sm font-semibold text-premium-gold-400 flex items-center gap-1.5">
          <Star className="h-4 w-4" />
          Upgrade to Featured
        </p>
        <p className="text-sm text-text-secondary mt-0.5">
          Get more visibility with a promoted position in search results and on
          the homepage. One-time fee of {formatGbpFromPence(featuredUpgradePricePence)}.
        </p>
        {pendingReview ? (
          <p className="text-sm text-text-secondary mt-1">{pendingCopy}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="premium"
        size="sm"
        onClick={handleUpgrade}
        disabled={checkoutUnavailable || uncertain}
        loading={isPending}
        aria-busy={isPending || undefined}
        className="shrink-0"
      >
        <Star className="h-3.5 w-3.5" />
        Upgrade - {formatGbpFromPence(featuredUpgradePricePence)}
      </Button>
      {checkoutUnavailable && (
        <p className="text-sm text-text-secondary" role="note">
          New payments are disabled on preview.
        </p>
      )}
      {error && (
        <p className="text-sm text-text-energy w-full" role="alert">
          {error}
        </p>
      )}
      {uncertain ? <a href={`/listings/${listingId}`} className="text-text-trust underline">Check Featured status</a> : null}
      <PaymentAwaitingStatus sampleCheckoutId={sampleCheckoutId}
        isAwaitingPayment={isAwaitingPayment}
        message="Checkout is open in another tab. This page will update when the payment service confirms the featured upgrade."
      />
      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel="featured upgrade"
      />
    </div>
  );
}
