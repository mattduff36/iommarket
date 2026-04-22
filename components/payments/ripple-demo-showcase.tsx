"use client";

import { useState } from "react";
import { ArrowUpRight, CheckCircle2, CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";

export interface RippleDemoFlowAction {
  id: string;
  label: string;
  checkoutLabel: string;
  checkoutUrl: string;
  variant?: "trust" | "premium" | "energy" | "ghost";
}

export interface RippleDemoFlow {
  id: string;
  eyebrow: string;
  title: string;
  price: string;
  description: string;
  highlights: readonly string[];
  actions: readonly RippleDemoFlowAction[];
}

interface RippleDemoShowcaseProps {
  providerName: string;
  preferredCheckoutSurface: "HOSTED" | "EMBED";
  supportsEmbeddedCheckout: boolean;
  portalUrl: string | null;
  flows: readonly RippleDemoFlow[];
}

const DELIVERY_STEPS = [
  "Start inside iomarket",
  "Explain demo mode in a modal",
  "Open hosted Ripple checkout in a new tab",
  "Swap in live credentials after onboarding",
] as const;

export function RippleDemoShowcase({
  providerName,
  preferredCheckoutSurface,
  supportsEmbeddedCheckout,
  portalUrl,
  flows,
}: RippleDemoShowcaseProps) {
  const [selectedCheckoutLabel, setSelectedCheckoutLabel] = useState("client preview payment");
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {flows.map((flow) => (
              <Card
                key={flow.id}
                className="relative overflow-hidden border-border bg-surface/70 shadow-high"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-blue-500/70 to-transparent" />
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neon-blue-400">
                        {flow.eyebrow}
                      </p>
                      <CardTitle className="mt-2 font-heading text-2xl text-text-primary">
                        {flow.title}
                      </CardTitle>
                    </div>
                    <div className="rounded-full border border-neon-blue-500/30 bg-neon-blue-500/10 px-3 py-1 text-xs font-semibold text-neon-blue-300">
                      {flow.price}
                    </div>
                  </div>
                  <CardDescription className="text-sm leading-6 text-text-secondary">
                    {flow.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <ul className="space-y-2">
                    {flow.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="flex items-start gap-2 text-sm text-text-secondary"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-blue-400" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-3">
                    {flow.actions.map((action) => (
                      <Button
                        key={action.id}
                        variant={action.variant ?? "trust"}
                        onClick={() => {
                          setSelectedCheckoutLabel(action.checkoutLabel);
                          openCheckout(action.checkoutUrl);
                        }}
                        rightIcon={<ArrowUpRight className="h-4 w-4" />}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <Card className="border-neon-blue-500/25 bg-canvas/70 shadow-high">
            <CardHeader>
              <div className="flex items-center gap-2 text-neon-blue-400">
                <CreditCard className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">
                  Delivery Shape
                </span>
              </div>
              <CardTitle className="font-heading text-xl">
                How the client preview works
              </CardTitle>
              <CardDescription className="leading-6">
                This page uses the same fallback strategy already wired into the
                live marketplace flows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-surface/60 p-4 text-sm text-text-secondary">
                <p>
                  Active provider: <span className="font-semibold text-text-primary">{providerName}</span>
                </p>
                <p className="mt-2">
                  Preferred surface:{" "}
                  <span className="font-semibold text-text-primary">
                    {preferredCheckoutSurface === "HOSTED" ? "Hosted checkout" : "Embedded checkout"}
                  </span>
                </p>
                <p className="mt-2">
                  Embed support today:{" "}
                  <span className="font-semibold text-text-primary">
                    {supportsEmbeddedCheckout ? "Available" : "Not enabled yet"}
                  </span>
                </p>
              </div>

              <div className="space-y-3">
                {DELIVERY_STEPS.map((step, index) => (
                  <div key={step} className="flex items-start gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon-blue-500/30 bg-neon-blue-500/10 text-xs font-bold text-neon-blue-300">
                      {index + 1}
                    </div>
                    <div className="pt-1 text-sm text-text-secondary">{step}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-premium-gold-500/20 bg-premium-gold-500/5 shadow-high">
            <CardHeader>
              <CardTitle className="font-heading text-xl">
                What becomes real after onboarding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-text-secondary">
              <p>
                The visual redirect pattern you show the client here stays the
                same. The only change later is that the checkout URLs, plan IDs,
                and webhook secret become account-specific.
              </p>
              <p>
                Once those are in place, successful payments and subscriptions
                can flow back into `iomarket` automatically via webhooks.
              </p>
              {portalUrl ? (
                <Button asChild variant="ghost">
                  <a href={portalUrl} target="_blank" rel="noreferrer">
                    Open Ripple portal preview
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel={selectedCheckoutLabel}
      />
    </>
  );
}
