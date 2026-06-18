"use client";

import { useState, useTransition } from "react";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { deleteWaitlistUser } from "@/actions/waitlist";

interface Props {
  id: string;
  email: string;
}

export function DeleteWaitlistButton({ id, email }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDeleteClick() {
    setConfirming(true);
    setError(null);
  }

  function handleCancel() {
    setConfirming(false);
    setError(null);
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteWaitlistUser(id);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
        <span className="text-xs text-text-secondary hidden sm:inline truncate max-w-[120px]" title={email}>
          Delete {email}?
        </span>
        <AdminActionButton
          onClick={handleConfirm}
          disabled={isPending}
          tone="danger"
        >
          {isPending ? "Deleting…" : "Confirm"}
        </AdminActionButton>
        <AdminActionButton
          onClick={handleCancel}
          disabled={isPending}
        >
          Cancel
        </AdminActionButton>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </AdminActionBar>
    );
  }

  return (
    <AdminActionButton
      onClick={handleDeleteClick}
      tone="danger"
    >
      Delete
    </AdminActionButton>
  );
}
