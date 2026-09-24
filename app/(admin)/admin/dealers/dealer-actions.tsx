"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminRowActions,
  compactAdminRowActions,
} from "@/components/admin/admin-row-actions";
import { verifyDealer, downgradeDealerToUser } from "@/actions/admin/dealers";
import { setDealerTier } from "@/actions/admin/dealer-tier";
import { DealerAccessDialog } from "../users/dealer-access-dialog";
import type { DealerTier } from "@prisma/client";

interface DealerActionsProps {
  dealerId: string;
  dealerName?: string;
  userId: string;
  userLabel: string;
  verified: boolean;
  canGrantAccess: boolean;
  currentTier: DealerTier;
  hasActivePaidSubscription: boolean;
}

const PACKAGES = [
  { value: "STARTER", label: "Dealer Starter" },
  { value: "PRO", label: "Dealer Pro" },
] satisfies Array<{ value: DealerTier; label: string }>;

function readError(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

export function DealerActions({
  dealerId,
  dealerName,
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
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);
  const [isDealerAccessDialogOpen, setIsDealerAccessDialogOpen] = useState(false);
  const entityLabel = dealerName ?? userLabel;

  function runAction(
    label: string,
    action: () => Promise<{ error?: unknown }>,
    fallback: string,
  ) {
    setError(null);
    setPendingLabel(label);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(readError(result.error, fallback));
          return;
        }
        setConfirmDowngrade(false);
        router.refresh();
      } finally {
        setPendingLabel(null);
      }
    });
  }

  const actions = compactAdminRowActions([
    {
      kind: "command",
      id: "verify",
      label: verified ? "Unverify dealer" : "Verify dealer",
      onSelect: () =>
        runAction(
          verified ? "Removing verification…" : "Verifying…",
          () => verifyDealer(dealerId, !verified),
          "Failed to update verification",
        ),
    },
    hasActivePaidSubscription
      ? null
      : {
          kind: "menu",
          id: "package",
          label: "Change package",
          value: currentTier,
          choices: PACKAGES,
          onSelect: (value) => {
            const tier = value as DealerTier;
            if (tier === currentTier) return;
            runAction(
              "Updating package…",
              () => setDealerTier({ userId, tier }),
              "Failed to update dealer package",
            );
          },
        },
    canGrantAccess
      ? {
          kind: "command",
          id: "grant",
          label: "Grant free access",
          onSelect: () => setIsDealerAccessDialogOpen(true),
        }
      : null,
    {
      kind: "link",
      id: "onboarding",
      label: "Onboarding email",
      href: `/admin/dealer-onboarding?dealer=${dealerId}`,
    },
    {
      kind: "command",
      id: "downgrade",
      label: "Downgrade to user",
      destructive: true,
      onSelect: () => setConfirmDowngrade(true),
    },
  ]);

  return (
    <div className="space-y-2">
      <AdminRowActions
        label={`Actions for ${entityLabel}`}
        actions={actions}
        pendingLabel={pendingLabel ?? undefined}
      />
      {hasActivePaidSubscription ? (
        <p className="text-xs text-text-tertiary">
          Package is set by the paid subscription and cannot be changed.
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      <DealerAccessDialog
        userId={userId}
        userLabel={userLabel}
        mode="grant"
        open={isDealerAccessDialogOpen}
        onOpenChange={setIsDealerAccessDialogOpen}
        onCompleted={() => router.refresh()}
      />
      <AdminConfirmDialog
        open={confirmDowngrade}
        onOpenChange={setConfirmDowngrade}
        title={`Downgrade ${entityLabel}?`}
        description="The owner becomes a user, complimentary access is revoked, and a paid subscription is set to end at the current period."
        confirmLabel="Downgrade to user"
        destructive
        pending={isPending}
        onConfirm={() =>
          runAction(
            "Downgrading…",
            () => downgradeDealerToUser(dealerId),
            "Failed to downgrade dealer",
          )
        }
      />
    </div>
  );
}
