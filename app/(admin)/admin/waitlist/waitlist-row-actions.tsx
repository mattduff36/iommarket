"use client";

import { useState, useTransition } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminRowActions,
  type AdminRowAction,
} from "@/components/admin/admin-row-actions";
import { deleteWaitlistUser, restoreWaitlistUser } from "@/actions/waitlist";

interface WaitlistRowActionsProps {
  id: string;
  email: string;
  deleted: boolean;
}

export function WaitlistRowActions({ id, email, deleted }: WaitlistRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the email address");
    }
  }

  function handleRestore() {
    setError(null);
    setPendingLabel("Restoring…");
    startTransition(async () => {
      try {
        const result = await restoreWaitlistUser(id);
        if (result.error) setError(result.error);
      } finally {
        setPendingLabel(null);
      }
    });
  }

  function handleDelete() {
    setError(null);
    setPendingLabel("Deleting…");
    startTransition(async () => {
      try {
        const result = await deleteWaitlistUser(id);
        if (result.error) {
          setError(result.error);
          return;
        }
        setConfirmDelete(false);
      } finally {
        setPendingLabel(null);
      }
    });
  }

  const actions: AdminRowAction[] = [
    {
      kind: "command",
      id: "copy",
      label: copied ? "Email copied" : "Copy email",
      onSelect: () => {
        void handleCopy();
      },
    },
    deleted
      ? { kind: "command", id: "restore", label: "Restore", onSelect: handleRestore }
      : {
          kind: "command",
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: () => setConfirmDelete(true),
        },
  ];

  return (
    <div className="space-y-2">
      <AdminRowActions
        label={`Actions for ${email}`}
        actions={actions}
        pendingLabel={pendingLabel ?? undefined}
      />
      {error ? (
        <p className="text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      <AdminConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${email}?`}
        description="This removes the waitlist entry. It can be restored from deleted entries."
        confirmLabel="Delete entry"
        destructive
        pending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
