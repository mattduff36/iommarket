"use client";

import { useTransition } from "react";
import { devActivateDealerSubscription } from "@/actions/dev-bypass";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";

export function DevSubscriptionBypass() {
  const [isPending, startTransition] = useTransition();

  function handleBypass() {
    startTransition(async () => {
      const result = await devActivateDealerSubscription();
      if (result.error) {
        alert(`Dev bypass error: ${result.error}`);
      }
    });
  }

  return (
    <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-500 mb-0.5">
          Dev Mode
        </p>
        <p className="text-sm text-text-secondary">
          Stripe not configured. Use the bypass below to simulate a paid subscription.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 shrink-0"
        onClick={handleBypass}
        loading={isPending}
      >
        <Zap className="h-3.5 w-3.5" />
        Activate Subscription (Dev)
      </Button>
    </div>
  );
}
