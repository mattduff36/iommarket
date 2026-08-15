"use client";

import { useState, useTransition } from "react";
import { upgradeFeatured } from "@/actions/payments";
import { Button } from "@/components/ui/button";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { Star } from "lucide-react";
import { formatGbpFromPence } from "@/lib/formatting/gbp";
import { PaymentAwaitingStatus } from "@/components/payments/payment-awaiting-status";

interface FeaturedUpgradeButtonProps {
  listingId: string;
  featuredUpgradePricePence: number;
  variant?: "card" | "inline";
}

export function FeaturedUpgradeButton({
  listingId,
  featuredUpgradePricePence,
  variant = "card",
}: FeaturedUpgradeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const [error, setError] = useState<string | null>(null);
  const [isAwaitingPayment, setIsAwaitingPayment] = useState(false);

  function handleUpgrade() {
    setError(null);
    startTransition(async () => {
      const result = await upgradeFeatured(listingId);
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to start checkout. Please try again."
        );
        return;
      }
      if (result.data?.checkoutUrl) {
        openCheckout(result.data.checkoutUrl);
        setIsAwaitingPayment(true);
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
          loading={isPending}
          className="text-premium-gold-400 hover:text-premium-gold-500"
          title="Upgrade to featured"
        >
          <Star className="h-3.5 w-3.5" />
          Feature
        </Button>
        {error && (
          <p className="text-xs text-text-error" role="alert">
            {error}
          </p>
        )}
        <PaymentAwaitingStatus
          isAwaitingPayment={isAwaitingPayment}
          message="Checkout is open in another tab. This page will update when Ripple confirms the featured upgrade."
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
      </div>
      <Button
        variant="premium"
        size="sm"
        onClick={handleUpgrade}
        loading={isPending}
        className="shrink-0"
      >
        <Star className="h-3.5 w-3.5" />
        Upgrade — {formatGbpFromPence(featuredUpgradePricePence)}
      </Button>
      {error && (
        <p className="text-sm text-text-energy w-full" role="alert">
          {error}
        </p>
      )}
      <PaymentAwaitingStatus
        isAwaitingPayment={isAwaitingPayment}
        message="Checkout is open in another tab. This page will update when Ripple confirms the featured upgrade."
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
