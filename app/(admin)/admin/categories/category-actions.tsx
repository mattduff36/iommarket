"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAttributeDefinition, toggleCategoryActive, deleteCategory } from "@/actions/admin";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
  AdminRowActions,
  compactAdminRowActions,
} from "@/components/admin/admin-row-actions";
import { X } from "lucide-react";

interface AttributeDeleteProps {
  attrId: string;
  attrName: string;
}

export function AttributeDeleteButton({ attrId, attrName }: AttributeDeleteProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={isPending}
        aria-label={`Remove ${attrName}`}
        className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-elevated disabled:opacity-40 transition-colors"
      >
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </button>
      <AdminConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove ${attrName}?`}
        description="This permanently removes the attribute definition."
        confirmLabel="Remove attribute"
        destructive
        pending={isPending}
        onConfirm={() => {
          startTransition(async () => {
            await deleteAttributeDefinition(attrId);
            setConfirmDelete(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}

interface CategoryRowActionsProps {
  categoryId: string;
  categoryName?: string;
  active: boolean;
  listingCount: number;
}

function readError(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

export function CategoryRowActions({
  categoryId,
  categoryName = "this category",
  active,
  listingCount,
}: CategoryRowActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function runToggle() {
    setError(null);
    setPendingLabel(active ? "Deactivating…" : "Activating…");
    startTransition(async () => {
      try {
        await toggleCategoryActive(categoryId, !active);
        router.refresh();
      } finally {
        setPendingLabel(null);
      }
    });
  }

  function runDelete() {
    setError(null);
    setPendingLabel("Deleting…");
    startTransition(async () => {
      try {
        const result = await deleteCategory(categoryId);
        if (result.error) {
          setError(readError(result.error, "Failed to delete"));
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
      label: active ? "Deactivate" : "Activate",
      onSelect: runToggle,
    },
    listingCount === 0
      ? {
          kind: "command",
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: () => setConfirmDelete(true),
        }
      : null,
  ]);

  return (
    <div className="space-y-2">
      <AdminRowActions
        label={`Actions for ${categoryName}`}
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
        title={`Delete ${categoryName}?`}
        description="This permanently removes the category. It is only available when the category has no listings."
        confirmLabel="Delete category"
        destructive
        pending={isPending}
        onConfirm={runDelete}
      />
    </div>
  );
}
