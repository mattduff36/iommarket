"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { continueEarlyAccessClaim } from "@/actions/early-access";
import { Button } from "@/components/ui/button";

export function EarlyAccessContinueForm({
  recipientId,
  proof,
}: {
  recipientId: string;
  proof: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function continueClaim() {
    setPending(true);
    setError(null);
    try {
      const result = await continueEarlyAccessClaim({ recipientId, proof });
      if (result.error || !result.data) {
        setError(result.error ?? "This invitation is no longer available.");
        return;
      }
      router.push(result.data.redirect);
      router.refresh();
    } catch {
      setError("This invitation is no longer available.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6">
      {error ? (
        <p className="mb-4 text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="trust" className="w-full" loading={pending} onClick={() => void continueClaim()}>
        {pending ? "Checking invitation…" : "Continue"}
      </Button>
    </div>
  );
}
