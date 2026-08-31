"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
  AdminSegmentedControl,
} from "@/components/admin/admin-action-controls";
import { verifyDealer, downgradeDealerToUser } from "@/actions/admin/dealers";
import { setDealerTier } from "@/actions/admin/dealer-tier";
import { DealerAccessDialog } from "../users/dealer-access-dialog";
import type { DealerTier } from "@prisma/client";

interface DealerActionsProps {
  dealerId: string;
  userId: string;
  userLabel: string;
  verified: boolean;
  canGrantAccess: boolean;
  currentTier: DealerTier;
  hasActivePaidSubscription: boolean;
}

export function DealerActions({
  dealerId,
  userId,
  userLabel,
  verified,
  canGrantAccess,
  currentTier,
  hasActivePaidSubscription,
}: DealerActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDealerAccessDialogOpen, setIsDealerAccessDialogOpen] = useState(false);

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

  function handlePackageChange(tier: DealerTier) {
    if (tier === currentTier) return;

    setError(null);
    startTransition(async () => {
      const result = await setDealerTier({ userId, tier });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to update dealer package"
        );
        return;
      }
      router.refresh();
    });
  }

  function handleDowngrade() {
    setError(null);
    startTransition(async () => {
      const result = await downgradeDealerToUser(dealerId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
        return;
      }
      setShowConfirm(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <AdminActionBar>
        <AdminSegmentedControl
          label="Package"
          value={currentTier}
          options={[
            { value: "STARTER", label: "Starter" },
            { value: "PRO", label: "Pro" },
          ]}
          onChange={handlePackageChange}
          disabled={isPending || hasActivePaidSubscription}
        />

        <AdminActionButton
          onClick={handleVerify}
          disabled={isPending}
          tone={verified ? "neutral" : "success"}
        >
          {verified ? "Unverify" : "Verify"}
        </AdminActionButton>

        {canGrantAccess ? (
          <AdminActionButton
            onClick={() => setIsDealerAccessDialogOpen(true)}
            disabled={isPending}
            tone="success"
          >
            Grant free access
          </AdminActionButton>
        ) : null}

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

      {hasActivePaidSubscription ? (
        <p className="text-xs text-text-tertiary">
          Package is set by the paid subscription and cannot be changed.
        </p>
      ) : null}
      {error && <p className="text-xs text-text-error">{error}</p>}
      <DealerAccessDialog
        userId={userId}
        userLabel={userLabel}
        mode="grant"
        open={isDealerAccessDialogOpen}
        onOpenChange={setIsDealerAccessDialogOpen}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
