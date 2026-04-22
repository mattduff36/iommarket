"use client";

import { useCallback, useState } from "react";
import { ArrowUpRight, BadgeAlert, CheckCircle2 } from "lucide-react";
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
}

export function RippleDemoCheckoutDialog({
  open,
  onOpenChange,
  checkoutUrl,
  checkoutLabel,
}: RippleDemoCheckoutDialogProps) {
  function handleContinue() {
    if (!checkoutUrl) return;
    window.location.href = checkoutUrl;
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
            experience before onboarding is complete.
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
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Stay on iomarket
          </Button>
          <Button
            variant="trust"
            onClick={handleContinue}
            disabled={!checkoutUrl}
            rightIcon={<ArrowUpRight className="h-4 w-4" />}
          >
            Open Ripple demo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useRippleDemoCheckout() {
  const [demoCheckoutUrl, setDemoCheckoutUrl] = useState<string | null>(null);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);

  const openCheckout = useCallback((checkoutUrl: string) => {
    if (isRippleDemoCheckoutUrl(checkoutUrl)) {
      setDemoCheckoutUrl(checkoutUrl);
      setDemoDialogOpen(true);
      return;
    }

    window.location.href = checkoutUrl;
  }, []);

  return {
    demoCheckoutUrl,
    demoDialogOpen,
    setDemoDialogOpen,
    openCheckout,
  };
}
