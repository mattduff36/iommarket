"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { useRef, useState, useTransition } from "react";
import { upgradeFeatured } from "@/actions/payments";
import { Button } from "@/components/ui/button";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { isUncertainActionResult, UNCERTAIN_CHECKOUT_MESSAGE } from "@/lib/forms/outcome-uncertainty";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
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
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const pendingCopy = "This purchase activates after the listing is approved.";

  function handleUpgrade() {
    if (submitLock.current || checkoutUnavailable || uncertain) return;
    if (checkoutUrl) {
      setShowStatus(true);
      return;
    }
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
          const url = result.data.checkoutUrl;
          const didOpen = openCheckout(url);
          if (!isRippleDemoCheckoutUrl(url)) {
            setCheckoutUrl(url);
            setDemoDialogOpen(false);
            setOpened(Boolean(didOpen));
            setShowStatus(true);
          }
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

  const statusDialog = (
    <Dialog open={showStatus} onOpenChange={setShowStatus}>
      <DialogContent>
        <DialogTitle>{opened ? "Complete your Featured upgrade" : "Open your payment page"}</DialogTitle>
        <DialogDescription>
          {opened ? "Your payment page opened in another tab. If you cannot find it, use either link below."
            : "Your browser may have blocked the payment tab. Allow pop-ups for this site in your browser settings, or continue in this tab."}
        </DialogDescription>
        {checkoutUrl && <div className="flex flex-wrap gap-3">
          <Button asChild><a href={checkoutUrl} target="_blank" rel="noopener noreferrer">Open payment page</a></Button>
          <Button asChild variant="ghost"><a href={checkoutUrl}>Continue in this tab</a></Button>
        </div>}
        <PaymentAwaitingStatus sampleCheckoutId={sampleCheckoutId} isAwaitingPayment={isAwaitingPayment}
          message="Featured placement updates after payment is confirmed." />
      </DialogContent>
    </Dialog>
  );

  if (variant === "inline") {
    return (
      <div className="inline-flex max-w-full flex-wrap items-center gap-2 [&>p]:basis-full">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUpgrade}
          disabled={checkoutUnavailable || uncertain}
          loading={isPending}
          aria-busy={isPending || undefined}
          className="w-full bg-premium-gold-400 text-black hover:bg-premium-gold-500 hover:text-black sm:w-auto"
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
          <ReportableError as="p" className="text-xs text-text-error" role="alert">
            {error}
          </ReportableError>
        )}
        {uncertain ? <a href={`/listings/${listingId}`} className="text-text-trust underline">Check Featured status</a> : null}
      {statusDialog}
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
        <ReportableError as="p" className="text-sm text-text-energy w-full" role="alert">
          {error}
        </ReportableError>
      )}
      {uncertain ? <a href={`/listings/${listingId}`} className="text-text-trust underline">Check Featured status</a> : null}
      {statusDialog}
      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel="featured upgrade"
      />
    </div>
  );
}
