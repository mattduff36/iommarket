"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setUserRole, setUserDisabled } from "@/actions/admin/users";
import type { UserRole } from "@prisma/client";

interface UserActionsProps {
  userId: string;
  currentRole: UserRole;
  isDisabled: boolean;
}

export function UserActions({ userId, currentRole, isDisabled }: UserActionsProps) {
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

  const roles: UserRole[] = ["USER", "DEALER", "ADMIN"];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <span className="text-xs text-text-tertiary mr-1">Role:</span>
        {roles.map((role) => (
          <Button
            key={role}
            size="sm"
            variant={currentRole === role ? "energy" : "ghost"}
            onClick={() => handleRoleChange(role)}
            disabled={isPending || currentRole === role}
            className="text-xs"
          >
            {role}
          </Button>
        ))}
      </div>

      <Button
        size="sm"
        variant={isDisabled ? "energy" : "ghost"}
        onClick={handleToggleDisabled}
        disabled={isPending}
        className="text-xs"
      >
        {isDisabled ? "Enable Account" : "Disable Account"}
      </Button>

      {isDisabled && <Badge variant="error">Disabled</Badge>}
      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
