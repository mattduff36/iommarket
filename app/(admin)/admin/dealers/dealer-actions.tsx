"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { verifyDealer, downgradeDealerToUser } from "@/actions/admin/dealers";

interface DealerActionsProps {
  dealerId: string;
  verified: boolean;
}

export function DealerActions({ dealerId, verified }: DealerActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyDealer(dealerId, !verified);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
  }

  function handleDowngrade() {
    setError(null);
    startTransition(async () => {
      const result = await downgradeDealerToUser(dealerId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowConfirm(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={verified ? "ghost" : "energy"}
        onClick={handleVerify}
        disabled={isPending}
        className="text-xs"
      >
        {verified ? "Unverify" : "Verify"}
      </Button>

      {!showConfirm ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          className="text-xs text-neon-red-400"
        >
          Downgrade to User
        </Button>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-error">Are you sure?</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDowngrade}
            disabled={isPending}
            className="text-xs text-neon-red-400"
          >
            Yes, downgrade
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowConfirm(false)}
            disabled={isPending}
            className="text-xs"
          >
            Cancel
          </Button>
        </div>
      )}

      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
