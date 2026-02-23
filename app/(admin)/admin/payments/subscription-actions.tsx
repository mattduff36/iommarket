"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adminCancelSubscription } from "@/actions/admin/payments";

interface CancelSubButtonProps {
  subscriptionId: string;
  status: string;
}

export function CancelSubButton({ subscriptionId, status }: CancelSubButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (status === "CANCELLED") return null;

  function handleCancel(immediately: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await adminCancelSubscription({ subscriptionId, immediately });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowConfirm(false);
  }

  return (
    <div className="flex items-center gap-1">
      {!showConfirm ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          className="text-xs text-neon-red-400"
        >
          Cancel
        </Button>
      ) : (
        <>
          <Button size="sm" variant="ghost" onClick={() => handleCancel(false)} disabled={isPending} className="text-xs">
            At period end
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleCancel(true)} disabled={isPending} className="text-xs text-neon-red-400">
            Immediately
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)} disabled={isPending} className="text-xs">
            Back
          </Button>
        </>
      )}
      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
