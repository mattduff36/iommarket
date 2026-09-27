"use client";

import { useState, useTransition } from "react";
import { verifyDealerCorrespondenceEmail } from "@/actions/dealer/correspondence";
import { Button } from "@/components/ui/button";

export function ConfirmCorrespondenceForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (confirmedEmail) {
    return (
      <p className="text-sm text-text-secondary">
        {confirmedEmail} is confirmed. Selected dealer emails will now be sent there. You can close this page.
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await verifyDealerCorrespondenceEmail({ token });
          if (result.error) {
            setError(result.error);
            return;
          }
          setConfirmedEmail(result.data?.verifiedEmail ?? "This address");
        });
      }}
    >
      <p className="text-sm text-text-secondary">
        Confirm that this inbox should receive the iTrader dealer emails selected on the dealer dashboard. This does not change the login email.
      </p>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      <Button type="submit" loading={isPending} disabled={isPending}>
        Confirm this email address
      </Button>
    </form>
  );
}
