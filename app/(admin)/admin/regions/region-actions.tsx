"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminRowActions,
  compactAdminRowActions,
} from "@/components/admin/admin-row-actions";
import { toggleRegionActive, deleteRegion } from "@/actions/admin/regions";

interface RegionActionsProps {
  regionId: string;
  regionName?: string;
  active: boolean;
  hasReferences: boolean;
}

function readError(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

export function RegionActions({
  regionId,
  regionName = "this region",
  active,
  hasReferences,
}: RegionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        setConfirmDelete(false);
        router.refresh();
      } finally {
        setPendingLabel(null);
      }
    });
  }

  const actions = compactAdminRowActions([
    {
      kind: "command",
      id: "toggle",
      label: active ? "Disable" : "Enable",
      onSelect: () =>
        runAction(
          active ? "Disabling…" : "Enabling…",
          () => toggleRegionActive(regionId, !active),
          "Failed to update region",
        ),
    },
    hasReferences
      ? null
      : {
          kind: "command",
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: () => setConfirmDelete(true),
        },
  ]);

  return (
    <div className="space-y-2">
      <AdminRowActions
        label={`Actions for ${regionName}`}
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
        title={`Delete ${regionName}?`}
        description="This permanently removes the region. It is only available when no users or listings reference it."
        confirmLabel="Delete region"
        destructive
        pending={isPending}
        onConfirm={() =>
          runAction("Deleting…", () => deleteRegion(regionId), "Failed to delete region")
        }
      />
    </div>
  );
}
