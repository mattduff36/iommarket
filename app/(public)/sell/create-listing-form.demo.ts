"use client";

import { useState, useTransition } from "react";
import { simulateDemoListingPaymentOutcome } from "@/actions/payments";

export function useListingDemoOutcome(params: {
  pendingListingId: string | null;
  mode: "private" | "dealer";
  setDemoDialogOpen: (open: boolean) => void;
  replace: (href: string) => void;
  refresh: () => void;
}) {
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();

  function handleSimulatedDemoOutcome(outcome: "success" | "declined") {
    const listingId = params.pendingListingId;
    if (!listingId) {
      setDemoOutcomeError("A listing must be created before simulating payment.");
      return;
    }

    setDemoOutcomeError(null);
    startSimulatingDemoOutcome(async () => {
      const result = await simulateDemoListingPaymentOutcome({
        listingId,
        flow: params.mode,
        outcome,
      });

      if (result.error) {
        setDemoOutcomeError(
          typeof result.error === "string"
            ? result.error
            : "Could not simulate the demo payment outcome.",
        );
        return;
      }

      params.setDemoDialogOpen(false);

      if (result.data?.nextUrl) {
        params.replace(result.data.nextUrl);
        return;
      }

      params.refresh();
    });
  }

  return {
    demoOutcomeError,
    isSimulatingDemoOutcome,
    handleSimulatedDemoOutcome,
    clearDemoOutcomeError: () => setDemoOutcomeError(null),
  };
}
