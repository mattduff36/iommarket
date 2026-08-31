"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  AdminActionBar,
  AdminActionButton,
  AdminSegmentedControl,
} from "@/components/admin/admin-action-controls";
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
}: UserActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isDealerAccessDialogOpen, setIsDealerAccessDialogOpen] = useState(false);
  const [isRevokeConfirmationVisible, setIsRevokeConfirmationVisible] =
    useState(false);

  function handleRoleChange(role: UserRole) {
    if (role === "DEALER" && currentRole !== "DEALER") {
      setError(null);
      setIsDealerAccessDialogOpen(true);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await setUserRole({ userId, role });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to update role");
      } else {
        router.refresh();
      }
    });
  }

  function handlePackageChange(tier: DealerTier) {
    if (!currentTier || tier === currentTier) return;

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

  function handleRevokeDealerAccess() {
    setError(null);
    startTransition(async () => {
      const result = await revokeDealerAccess({ userId });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to revoke free dealer access"
        );
        return;
      }

      setIsRevokeConfirmationVisible(false);
      router.refresh();
    });
  }

  function handleToggleDisabled() {
    setError(null);
    startTransition(async () => {
      const result = await setUserDisabled({
        userId,
        disabled: !isDisabled,
        reasonCode: isDisabled ? undefined : "POLICY",
        reason: isDisabled ? undefined : "Disabled by admin",
      });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to update status");
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!confirm("Soft-delete this account? Listings stay in the archive and can be restored.")) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteUser({ userId });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to delete user");
      } else if (redirectOnDelete) {
        router.push(redirectOnDelete);
        router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  const roles = [
    { value: "USER", label: "User" },
    { value: "DEALER", label: "Dealer" },
    { value: "ADMIN", label: "Admin" },
  ] satisfies Array<{ value: UserRole; label: string }>;

  return (
    <div className="space-y-2">
      <AdminActionBar>
        <AdminSegmentedControl
          label="Role"
          value={currentRole}
          options={roles}
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
          <AdminActionButton
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await restoreUser({ userId });
                if (result.error) {
                  setError(
                    typeof result.error === "string"
                      ? result.error
                      : "Failed to restore user",
                  );
                } else {
                  router.refresh();
                }
              });
            }}
            disabled={isPending}
            tone="success"
          >
            Restore
          </AdminActionButton>
        ) : (
          <AdminActionButton onClick={handleDelete} disabled={isPending} tone="danger">
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
          !isRevokeConfirmationVisible ? (
            <AdminActionButton
              onClick={() => setIsRevokeConfirmationVisible(true)}
              disabled={isPending}
              tone="danger"
            >
              Revoke free access
            </AdminActionButton>
          ) : (
            <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
              <span className="px-1 text-xs text-text-error">Revoke access?</span>
              <AdminActionButton
                onClick={handleRevokeDealerAccess}
                disabled={isPending}
                tone="danger"
              >
                Confirm
              </AdminActionButton>
              <AdminActionButton
                onClick={() => setIsRevokeConfirmationVisible(false)}
                disabled={isPending}
              >
                Cancel
              </AdminActionButton>
            </AdminActionBar>
          )
        ) : null}

        {isDisabled && <Badge variant="error">Disabled</Badge>}
      </AdminActionBar>
      {currentTier && hasActivePaidSubscription ? (
        <p className="text-xs text-text-tertiary">
          Package is set by the paid subscription and cannot be changed.
        </p>
      ) : null}
      {error && <p className="text-xs text-text-error">{error}</p>}
      <DealerAccessDialog
        userId={userId}
        userLabel={userLabel}
        mode={currentRole === "DEALER" ? "grant" : "promote"}
        open={isDealerAccessDialogOpen}
        onOpenChange={setIsDealerAccessDialogOpen}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
