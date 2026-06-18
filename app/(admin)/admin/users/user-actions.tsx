"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  AdminActionBar,
  AdminActionButton,
  AdminSegmentedControl,
} from "@/components/admin/admin-action-controls";
import { deleteUser, setUserRole, setUserDisabled } from "@/actions/admin/users";
import type { UserRole } from "@prisma/client";

interface UserActionsProps {
  userId: string;
  currentRole: UserRole;
  isDisabled: boolean;
  redirectOnDelete?: string;
}

export function UserActions({
  userId,
  currentRole,
  isDisabled,
  redirectOnDelete,
}: UserActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(role: UserRole) {
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

        {isDisabled && <Badge variant="error">Disabled</Badge>}
      </AdminActionBar>
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
