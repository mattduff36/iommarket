"use client";

import { useMutationRecovery } from "@/lib/forms/use-mutation-recovery";

import { useRef, useState, useTransition } from "react";
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
  revokeDealerAccess,
  setUserRole,
  setUserDisabled,
} from "@/actions/admin/users";
import {
  cancelDealerUpgradeOffer,
  resendDealerUpgradeOffer,
} from "@/actions/admin/dealer-upgrade-offers";
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
  pendingDealerUpgradeOfferId?: string | null;
  currentTier?: DealerTier | null;
  hasActivePaidSubscription?: boolean;
  redirectOnDelete?: string;
  variant?: "row" | "detail";
}

type ConfirmAction = "delete" | "disable" | "revoke" | "cancel-upgrade" | "role" | "package";

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
  pendingDealerUpgradeOfferId = null,
  currentTier = null,
  hasActivePaidSubscription = false,
  redirectOnDelete,
  variant = "detail",
}: UserActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const recovery = useMutationRecovery();
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [isDealerAccessDialogOpen, setIsDealerAccessDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [requestedRole, setRequestedRole] = useState<UserRole | null>(null);
  const [requestedTier, setRequestedTier] = useState<DealerTier | null>(null);
  const actionInFlight = useRef(false);
  const isWorking = isPending || pendingLabel !== null || recovery.blocked;
  const isDealerCapableRole =
    currentRole === "DEALER" || currentRole === "ADMIN";

  function runAction(
    label: string,
    action: () => Promise<{ error?: unknown; warning?: unknown }>,
    fallback: string,
    successMessage: string,
    onSuccess?: () => void,
  ) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError(null);
    setSuccess(null);
    setPendingLabel(label);
    startTransition(async () => {
      try {
        const result = await recovery.run(() => action());
        if (result.error) {
          setError(readError(result.error, fallback));
          return;
        }
        setSuccess(readError("warning" in result ? result.warning : undefined, successMessage));
        onSuccess?.();
        if (redirectOnDelete && label === "Deleting…") {
          router.push(redirectOnDelete);
        }
        router.refresh();
      } catch {
        setError(fallback);
      } finally {
        actionInFlight.current = false;
        setPendingLabel(null);
        setConfirmAction(null);
      }
    });
  }

  function handleRoleChange(role: UserRole) {
    if (actionInFlight.current) return;
    if (role === currentRole) return;
    if (role === "DEALER" && currentRole !== "DEALER") {
      setError(null);
      setIsDealerAccessDialogOpen(true);
      return;
    }
    setRequestedRole(role);
    setConfirmAction("role");
  }

  function handlePackageChange(tier: DealerTier) {
    if (
      !isDealerCapableRole ||
      !currentTier ||
      tier === currentTier ||
      hasActivePaidSubscription
    ) {
      return;
    }
    if (actionInFlight.current) return;
    setRequestedTier(tier);
    setConfirmAction("package");
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
      "Account enabled.",
    );
  }

  function handleDelete() {
    runAction(
      "Deleting…",
      () => deleteUser({ userId }),
      "Failed to delete user",
      "Account deleted.",
    );
  }

  function handleRevokeDealerAccess() {
    runAction(
      "Revoking access…",
      () => revokeDealerAccess({ userId }),
      "Failed to revoke free dealer access",
      "Complimentary dealer access revoked.",
    );
  }

  function handleResendDealerUpgradeOffer() {
    if (!pendingDealerUpgradeOfferId) return;
    runAction(
      "Resending offer…",
      () => resendDealerUpgradeOffer({ offerId: pendingDealerUpgradeOfferId }),
      "Failed to resend the dealer upgrade offer",
      "Dealer offer resent.",
    );
  }

  function handleCancelDealerUpgradeOffer() {
    if (!pendingDealerUpgradeOfferId) return;
    runAction(
      "Cancelling offer…",
      () => cancelDealerUpgradeOffer({ offerId: pendingDealerUpgradeOfferId }),
      "Failed to cancel the dealer upgrade offer",
      "Dealer offer cancelled.",
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
    isDealerCapableRole && currentTier && !hasActivePaidSubscription
      ? {
          kind: "menu",
          id: "package",
          label: "Change package",
          value: currentTier,
          choices: PACKAGES,
          onSelect: (value) => handlePackageChange(value as DealerTier),
        }
      : null,
    currentRole === "DEALER" && !hasActivePaidSubscription
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
    pendingDealerUpgradeOfferId
      ? {
          kind: "command",
          id: "resend-upgrade",
          label: "Resend dealer offer",
          onSelect: handleResendDealerUpgradeOffer,
        }
      : null,
    pendingDealerUpgradeOfferId
      ? {
          kind: "command",
          id: "cancel-upgrade",
          label: "Cancel dealer offer",
          destructive: true,
          onSelect: () => setConfirmAction("cancel-upgrade"),
        }
      : null,
    {
      kind: "command",
      id: "status",
      label: isDisabled ? "Enable" : "Disable",
      destructive: !isDisabled,
      onSelect: handleToggleDisabled,
    },
    {
      kind: "command",
      id: "delete",
      label: isDeleted ? "Delete permanently" : "Delete",
      destructive: true,
      onSelect: () => setConfirmAction("delete"),
    },
  ]);

  const confirmCopy = {
    delete: {
      title: `Delete ${userLabel}?`,
      description:
        "This permanently deletes the account, its login, and every listing it owns. The current password stops working and the profile is removed from the database. This cannot be undone.",
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
        "Complimentary dealer access ends. If there is no other active dealer entitlement, the account's dealer listings will be hidden until access is restored. The login remains active. Any paid Ripple subscription is unchanged and is not cancelled.",
      confirmLabel: "Revoke free access",
    },
    "cancel-upgrade": {
      title: `Cancel the dealer offer for ${userLabel}?`,
      description:
        "The account will remain a private-user account and the outstanding offer can no longer be accepted.",
      confirmLabel: "Cancel dealer offer",
    },
    role: {
      title: `Change ${userLabel}'s role to ${ROLES.find(({ value }) => value === requestedRole)?.label ?? "the selected role"}?`,
      description:
        requestedRole === "ADMIN"
          ? "This grants administrator access to the account."
          : "This changes the account's role and the permissions available to it.",
      confirmLabel: "Update role",
    },
    package: {
      title: `Change ${userLabel}'s package to ${PACKAGES.find(({ value }) => value === requestedTier)?.label ?? "the selected package"}?`,
      description: "This updates the dealer package for the account.",
      confirmLabel: "Update package",
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
            disabled={isWorking}
          />
          {isDealerCapableRole && currentTier ? (
            <AdminSegmentedControl
              label="Package"
              value={currentTier}
              options={[
                { value: "STARTER", label: "Starter" },
                { value: "PRO", label: "Pro" },
              ]}
              onChange={handlePackageChange}
              disabled={isWorking || hasActivePaidSubscription}
            />
          ) : null}
          <AdminActionButton
            onClick={handleToggleDisabled}
            disabled={isWorking}
            tone={isDisabled ? "success" : "warning"}
          >
            {isDisabled ? "Enable" : "Disable"}
          </AdminActionButton>
          <AdminActionButton
            onClick={() => setConfirmAction("delete")}
            disabled={isWorking}
            tone="danger"
          >
            {isDeleted ? "Delete permanently" : "Delete"}
          </AdminActionButton>
          {currentRole === "DEALER" && !hasActivePaidSubscription ? (
            <AdminActionButton
              onClick={() => setIsDealerAccessDialogOpen(true)}
              disabled={isWorking}
              tone="success"
            >
              {hasActiveAdminGrant ? "Extend free access" : "Grant free access"}
            </AdminActionButton>
          ) : null}
          {currentRole === "DEALER" && hasActiveAdminGrant ? (
            <AdminActionButton
              onClick={() => setConfirmAction("revoke")}
              disabled={isWorking}
              tone="danger"
            >
              Revoke free access
            </AdminActionButton>
          ) : null}
          {pendingDealerUpgradeOfferId ? (
            <>
              <AdminActionButton
                onClick={handleResendDealerUpgradeOffer}
                disabled={isWorking}
              >
                Resend dealer offer
              </AdminActionButton>
              <AdminActionButton
                onClick={() => setConfirmAction("cancel-upgrade")}
                disabled={isWorking}
                tone="danger"
              >
                Cancel dealer offer
              </AdminActionButton>
            </>
          ) : null}
        </AdminActionBar>
      )}

      {variant === "detail" &&
      isDealerCapableRole &&
      currentTier &&
      hasActivePaidSubscription ? (
        <p className="text-xs text-text-tertiary">
          Package is set by the paid subscription and cannot be changed.
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-xs text-emerald-500" role="status">
          {success}
        </p>
      ) : null}
      {recovery.blocked ? <a href={`/admin/users/${userId}`} className="block text-sm underline">Reload and check status</a> : null}

      <DealerAccessDialog
        userId={userId}
        userLabel={userLabel}
        mode={currentRole === "DEALER" ? "grant" : "promote"}
        open={isDealerAccessDialogOpen}
        onOpenChange={setIsDealerAccessDialogOpen}
        onCompleted={() => {
          setSuccess("Dealer access updated.");
          router.refresh();
        }}
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
        pending={isWorking}
        onConfirm={() => {
          if (actionInFlight.current) return;
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
              "Account disabled.",
            );
          }
          if (confirmAction === "revoke") handleRevokeDealerAccess();
          if (confirmAction === "cancel-upgrade") {
            handleCancelDealerUpgradeOffer();
          }
          if (confirmAction === "role" && requestedRole) {
            const role = requestedRole;
            runAction(
              "Updating role…",
              () => setUserRole({ userId, role }),
              "Failed to update role",
              "Account role updated.",
            );
          }
          if (confirmAction === "package" && requestedTier) {
            const tier = requestedTier;
            runAction(
              "Updating package…",
              () => setDealerTier({ userId, tier }),
              "Failed to update dealer package",
              "Dealer package updated.",
            );
          }
        }}
      />
    </div>
  );
}
