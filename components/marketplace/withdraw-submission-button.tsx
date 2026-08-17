"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawListingSubmission } from "@/actions/listings";
import { Button } from "@/components/ui/button";

interface WithdrawSubmissionButtonProps {
  listingId: string;
  expectedRevision: number;
  editHref: string;
}

export function WithdrawSubmissionButton({
  listingId,
  expectedRevision,
  editHref,
}: WithdrawSubmissionButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleWithdraw() {
    const confirmed = window.confirm(
      "Withdraw this submission from review? It will return to Draft so you can edit and resubmit it.",
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await withdrawListingSubmission({
        listingId,
        expectedRevision,
      });
      if (result.error) {
        setError(result.error);
        if (result.conflict) router.refresh();
        return;
      }

      router.push(editHref);
      router.refresh();
    });
  }

  return (
    <div className="inline-flex min-w-0 flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={handleWithdraw}
        loading={isPending}
        aria-busy={isPending}
        className="text-text-secondary hover:text-text-primary"
      >
        {isPending ? "Withdrawing…" : "Withdraw submission"}
      </Button>
      {error ? (
        <p className="max-w-64 text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
