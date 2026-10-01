"use client";

import { useCallback, useState } from "react";
import { ArrowUpRight, BadgeAlert, CheckCircle2, CircleSlash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";

interface RippleDemoCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutUrl: string | null;
  checkoutLabel: string;
  onManualCheckoutOpened?: () => void;
  demoOutcomeControls?: {
    isPending?: boolean;
    error?: string | null;
    onSimulateSuccess?: () => void;
    onSimulateDeclined?: () => void;
  };
}

export function openCheckoutInNewTab(checkoutUrl: string) {
  // A noopener window.open returns null even when it opens, so first obtain a
  // blank tab and sever its opener before navigating to provider content.
  const checkoutWindow = window.open("about:blank", "_blank");
  if (!checkoutWindow) return false;
  checkoutWindow.opener = null;
  const policy = checkoutWindow.document.createElement("meta");
  policy.name = "referrer";
  policy.content = "no-referrer";
  checkoutWindow.document.head.appendChild(policy);
  checkoutWindow.location.replace(checkoutUrl);
  checkoutWindow.focus();
  return true;
}

export function RippleDemoCheckoutDialog({
  open,
  onOpenChange,
  checkoutUrl,
  checkoutLabel,
  onManualCheckoutOpened,
  demoOutcomeControls,
}: RippleDemoCheckoutDialogProps) {
  function handleContinue() {
    if (!checkoutUrl) return;
    openCheckoutInNewTab(checkoutUrl);
  }

  if (checkoutUrl && !isRippleDemoCheckoutUrl(checkoutUrl)) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open payment checkout</DialogTitle>
            <DialogDescription>
              Your checkout is ready, but your browser did not open the payment tab.
              Use the button below to continue. Your saved listing is safe.
            </DialogDescription>
          </DialogHeader>
          <Button asChild>
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" onClick={onManualCheckoutOpened}>
              Open checkout in a new tab
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-neon-blue-500/20 bg-canvas/95 backdrop-blur">
        <DialogHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-neon-blue-500/30 bg-neon-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-neon-blue-400">
            <BadgeAlert className="h-3.5 w-3.5" />
            Demo Checkout
          </div>
          <DialogTitle className="text-xl">
            Preview the Ripple hosted payment journey
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            This {checkoutLabel} flow is currently using Ripple&apos;s public
            `demo-gym` checkout so you can show the client the hosted redirect
            experience before onboarding is complete. It opens in a separate
            tab so the original `iomarket` tab keeps your place and saved draft.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-surface/60 p-4">
            <p className="text-sm font-semibold text-text-primary">
              What works right now
            </p>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue-400" />
                You can demonstrate the redirect out of `iommarket` into a
                hosted Ripple page.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue-400" />
                The client can see the kind of checkout surface Ripple will own.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue-400" />
                The original `iomarket` tab stays open so the saved listing
                draft is never stranded behind the hosted payment page.
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-premium-gold-500/20 bg-premium-gold-500/5 p-4">
            <p className="text-sm font-semibold text-text-primary">
              What still needs onboarding
            </p>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Real payment confirmation, webhook updates, and account-specific
              subscription mapping will not sync back into `iommarket` until
              Ripple provides the live webhook secret, hosted URLs, and plan IDs.
            </p>
          </div>

          {demoOutcomeControls ? (
            <div className="rounded-lg border border-neon-blue-500/25 bg-neon-blue-500/8 p-4">
              <p className="text-sm font-semibold text-text-primary">
                Temporary test controls
              </p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Because webhook confirmation is not wired yet, use these buttons
                to emulate the Ripple webhook outcome that will update `iomarket`
                automatically once onboarding is complete.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 shadow-[0_0_0_1px_rgba(16,185,129,0.18)] hover:bg-emerald-500/25 hover:text-white"
                  onClick={demoOutcomeControls.onSimulateSuccess}
                  disabled={
                    !demoOutcomeControls.onSimulateSuccess ||
                    demoOutcomeControls.isPending
                  }
                  loading={demoOutcomeControls.isPending}
                  rightIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                >
                  Emulate successful payment
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="border border-rose-500/45 bg-rose-500/15 text-rose-200 shadow-[0_0_0_1px_rgba(244,63,94,0.18)] hover:bg-rose-500/25 hover:text-white"
                  onClick={demoOutcomeControls.onSimulateDeclined}
                  disabled={
                    !demoOutcomeControls.onSimulateDeclined ||
                    demoOutcomeControls.isPending
                  }
                  rightIcon={<CircleSlash className="h-3.5 w-3.5" />}
                >
                  Emulate declined payment
                </Button>
              </div>
              {demoOutcomeControls.error ? (
                <p className="mt-3 text-sm text-text-error">
                  {demoOutcomeControls.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-3 sm:justify-between">
          <Button variant="energy" onClick={() => onOpenChange(false)}>
            Stay on iomarket
          </Button>
          <Button
            variant="trust"
            onClick={handleContinue}
            disabled={!checkoutUrl}
            rightIcon={<ArrowUpRight className="h-4 w-4" />}
          >
            Open Ripple demo in new tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useRippleDemoCheckout() {
  const [demoCheckoutUrl, setDemoCheckoutUrl] = useState<string | null>(null);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [sampleCheckoutId, setSampleCheckoutId] = useState<string | null>(null);

  const openCheckout = useCallback((checkoutUrl: string) => {
    setSampleCheckoutId(/^\/sample-checkout\/([a-z0-9]+)$/.exec(checkoutUrl)?.[1] ?? null);
    if (isRippleDemoCheckoutUrl(checkoutUrl)) {
      setDemoCheckoutUrl(checkoutUrl);
      setDemoDialogOpen(true);
      return false;
    }

    const opened = openCheckoutInNewTab(checkoutUrl);
    if (!opened) {
      setDemoCheckoutUrl(checkoutUrl);
      setDemoDialogOpen(true);
    }
    return opened;
  }, []);

  return {
    sampleCheckoutId,
    demoCheckoutUrl,
    demoDialogOpen,
    setDemoDialogOpen,
    openCheckout,
  };
}
