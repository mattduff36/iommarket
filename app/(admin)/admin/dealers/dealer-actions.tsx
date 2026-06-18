"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
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
    <div className="space-y-2">
      <AdminActionBar>
        <AdminActionButton
          onClick={handleVerify}
          disabled={isPending}
          tone={verified ? "neutral" : "success"}
        >
          {verified ? "Unverify" : "Verify"}
        </AdminActionButton>

        {!showConfirm ? (
          <AdminActionButton
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
            tone="danger"
          >
            Downgrade
          </AdminActionButton>
        ) : (
          <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
            <span className="px-1 text-xs text-text-error">Downgrade?</span>
            <AdminActionButton
              onClick={handleDowngrade}
              disabled={isPending}
              tone="danger"
            >
              Confirm
            </AdminActionButton>
            <AdminActionButton
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
            >
              Cancel
            </AdminActionButton>
          </AdminActionBar>
        )}
      </AdminActionBar>

      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
