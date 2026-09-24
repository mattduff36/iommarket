"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
  AdminSegmentedControl,
} from "@/components/admin/admin-action-controls";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminRowActions,
  compactAdminRowActions,
} from "@/components/admin/admin-row-actions";
import {
  deleteUser,
  restoreUser,
  revokeDealerAccess,
  setUserRole,
  setUserDisabled,
} from "@/actions/admin/users";
import { setDealerTier } from "@/actions/admin/dealer-tier";
import type { DealerTier, UserRole } from "@prisma/client";
import { DealerAccessDialog } from "./dealer-access-dialog";

interface UserActionsProps {
  userId: string;
  currentRole: UserRole;
  isDisabled: boolean;
  isDeleted?: boolean;
  userLabel?: string;
  hasActiveAdminGrant?: boolean;
  currentTier?: DealerTier | null;
  hasActivePaidSubscription?: boolean;
  redirectOnDelete?: string;
  variant?: "row" | "detail";
}

type ConfirmAction = "delete" | "disable" | "revoke";

const ROLES = [
  { value: "USER", label: "User" },
  { value: "DEALER", label: "Dealer" },
  { value: "ADMIN", label: "Admin" },
] satisfies Array<{ value: UserRole; label: string }>;

const PACKAGES = [
  { value: "STARTER", label: "Dealer Starter" },
  { value: "PRO", label: "Dealer Pro" },
] satisfies Array<{ value: DealerTier; label: string }>;

function readError(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

export function UserActions({
  userId,
  currentRole,
  isDisabled,
  isDeleted = false,
  userLabel = "this account",
  hasActiveAdminGrant = false,
  currentTier = null,
  hasActivePaidSubscription = false,
  redirectOnDelete,
  variant = "detail",
}: UserActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [isDealerAccessDialogOpen, setIsDealerAccessDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  function runAction(
    label: string,
    action: () => Promise<{ error?: unknown }>,
    fallback: string,
    onSuccess?: () => void,
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
        onSuccess?.();
        if (redirectOnDelete && label === "Deleting…") {
          router.push(redirectOnDelete);
        }
        router.refresh();
      } finally {
        setPendingLabel(null);
        setConfirmAction(null);
      }
    });
  }

  function handleRoleChange(role: UserRole) {
    if (role === currentRole) return;
    if (role === "DEALER" && currentRole !== "DEALER") {
      setError(null);
      setIsDealerAccessDialogOpen(true);
      return;
    }
    runAction("Updating role…", () => setUserRole({ userId, role }), "Failed to update role");
  }

  function handlePackageChange(tier: DealerTier) {
    if (!currentTier || tier === currentTier || hasActivePaidSubscription) return;
    runAction(
      "Updating package…",
      () => setDealerTier({ userId, tier }),
      "Failed to update dealer package",
    );
  }

  function handleToggleDisabled() {
    if (!isDisabled) {
      setConfirmAction("disable");
      return;
    }
    runAction(
      "Enabling…",
      () => setUserDisabled({ userId, disabled: false }),
      "Failed to update status",
    );
  }

  function handleDelete() {
    runAction(
      "Deleting…",
      () => deleteUser({ userId }),
      "Failed to delete user",
    );
  }

  function handleRestore() {
    runAction("Restoring…", () => restoreUser({ userId }), "Failed to restore user");
  }

  function handleRevokeDealerAccess() {
    runAction(
      "Revoking access…",
      () => revokeDealerAccess({ userId }),
      "Failed to revoke free dealer access",
    );
  }

  const rowActions = compactAdminRowActions([
    {
      kind: "link",
      id: "view",
      label: "View account",
      href: `/admin/users/${userId}`,
    },
    {
      kind: "menu",
      id: "role",
      label: "Change role",
      value: currentRole,
      choices: ROLES,
      onSelect: (value) => handleRoleChange(value as UserRole),
    },
    currentTier && !hasActivePaidSubscription
      ? {
          kind: "menu",
          id: "package",
          label: "Change package",
          value: currentTier,
          choices: PACKAGES,
          onSelect: (value) => handlePackageChange(value as DealerTier),
        }
      : null,
    currentRole === "DEALER"
      ? {
          kind: "command",
          id: "grant",
          label: hasActiveAdminGrant ? "Extend free access" : "Grant free access",
          onSelect: () => setIsDealerAccessDialogOpen(true),
        }
      : null,
    currentRole === "DEALER" && hasActiveAdminGrant
      ? {
          kind: "command",
          id: "revoke",
          label: "Revoke free access",
          destructive: true,
          onSelect: () => setConfirmAction("revoke"),
        }
      : null,
    {
      kind: "command",
      id: "status",
      label: isDisabled ? "Enable" : "Disable",
      destructive: !isDisabled,
      onSelect: handleToggleDisabled,
    },
    isDeleted
      ? { kind: "command", id: "restore", label: "Restore", onSelect: handleRestore }
      : {
          kind: "command",
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: () => setConfirmAction("delete"),
        },
  ]);

  const confirmCopy = {
    delete: {
      title: `Delete ${userLabel}?`,
      description:
        "This marks the account deleted and disabled. Listings stay archived, and the account can be restored.",
      confirmLabel: "Delete account",
    },
    disable: {
      title: `Disable ${userLabel}?`,
      description: "The account cannot be used until an administrator enables it.",
      confirmLabel: "Disable account",
    },
    revoke: {
      title: `Revoke free access for ${userLabel}?`,
      description:
        "Complimentary dealer access ends. A paid subscription is not changed by this action.",
      confirmLabel: "Revoke free access",
    },
  }[confirmAction ?? "delete"];

  return (
    <div className="space-y-2">
      {variant === "row" ? (
        <AdminRowActions
          label={`Actions for ${userLabel}`}
          actions={rowActions}
          pendingLabel={pendingLabel ?? undefined}
        />
      ) : (
        <AdminActionBar label={`Actions for ${userLabel}`}>
          <AdminSegmentedControl
            label="Role"
            value={currentRole}
            options={ROLES}
            onChange={handleRoleChange}
            disabled={isPending}
          />
          {currentTier ? (
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
          ) : null}
          <AdminActionButton
            onClick={handleToggleDisabled}
            disabled={isPending}
            tone={isDisabled ? "success" : "warning"}
          >
            {isDisabled ? "Enable" : "Disable"}
          </AdminActionButton>
          {isDeleted ? (
            <AdminActionButton onClick={handleRestore} disabled={isPending} tone="success">
              Restore
            </AdminActionButton>
          ) : (
            <AdminActionButton
              onClick={() => setConfirmAction("delete")}
              disabled={isPending}
              tone="danger"
            >
              Delete
            </AdminActionButton>
          )}
          {currentRole === "DEALER" ? (
            <AdminActionButton
              onClick={() => setIsDealerAccessDialogOpen(true)}
              disabled={isPending}
              tone="success"
            >
              {hasActiveAdminGrant ? "Extend free access" : "Grant free access"}
            </AdminActionButton>
          ) : null}
          {currentRole === "DEALER" && hasActiveAdminGrant ? (
            <AdminActionButton
              onClick={() => setConfirmAction("revoke")}
              disabled={isPending}
              tone="danger"
            >
              Revoke free access
            </AdminActionButton>
          ) : null}
        </AdminActionBar>
      )}

      {variant === "detail" && currentTier && hasActivePaidSubscription ? (
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
        mode={currentRole === "DEALER" ? "grant" : "promote"}
        open={isDealerAccessDialogOpen}
        onOpenChange={setIsDealerAccessDialogOpen}
        onCompleted={() => router.refresh()}
      />
      <AdminConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive
        pending={isPending}
        onConfirm={() => {
          if (confirmAction === "delete") handleDelete();
          if (confirmAction === "disable") {
            runAction(
              "Disabling…",
              () =>
                setUserDisabled({
                  userId,
                  disabled: true,
                  reasonCode: "POLICY",
                  reason: "Disabled by admin",
                }),
              "Failed to update status",
            );
          }
          if (confirmAction === "revoke") handleRevokeDealerAccess();
        }}
      />
    </div>
  );
}
