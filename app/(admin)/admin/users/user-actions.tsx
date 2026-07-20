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
  revokeDealerAccess,
  setUserRole,
  setUserDisabled,
} from "@/actions/admin/users";
import type { UserRole } from "@prisma/client";
import { DealerAccessDialog } from "./dealer-access-dialog";

interface UserActionsProps {
  userId: string;
  currentRole: UserRole;
  isDisabled: boolean;
  userLabel?: string;
  hasActiveAdminGrant?: boolean;
  redirectOnDelete?: string;
}

export function UserActions({
  userId,
  currentRole,
  isDisabled,
  userLabel = "this account",
  hasActiveAdminGrant = false,
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
      const result = await setUserDisabled({ userId, disabled: !isDisabled });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to update status");
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!confirm("Delete this account permanently? This cannot be undone.")) return;

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

        <AdminActionButton
          onClick={handleToggleDisabled}
          disabled={isPending}
          tone={isDisabled ? "success" : "warning"}
        >
          {isDisabled ? "Enable" : "Disable"}
        </AdminActionButton>

        <AdminActionButton onClick={handleDelete} disabled={isPending} tone="danger">
          Delete
        </AdminActionButton>

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
