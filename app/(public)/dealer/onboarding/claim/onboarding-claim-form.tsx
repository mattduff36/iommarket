"use client";

import { useState, useTransition } from "react";
import { beginDealerOnboardingClaim } from "@/actions/dealer-onboarding";
import { Button } from "@/components/ui/button";

export function OnboardingClaimForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await beginDealerOnboardingClaim({ token });
          if (result?.error) setError(result.error);
        });
      }}
    >
      <p className="text-sm text-text-secondary">
        Continue only if you were expecting this iTrader dealer invitation. The next step confirms the existing dealer account before you choose a password or accept any documents.
      </p>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Continuing…" : "Continue securely"}
      </Button>
    </form>
  );
}
