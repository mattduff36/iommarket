"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAttributeDefinition, toggleCategoryActive, deleteCategory } from "@/actions/admin";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { X, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Delete a single attribute badge inline in the table
// ---------------------------------------------------------------------------

interface AttributeDeleteProps {
  attrId: string;
  attrName: string;
}

export function AttributeDeleteButton({ attrId, attrName }: AttributeDeleteProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Remove attribute "${attrName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteAttributeDefinition(attrId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      aria-label={`Remove ${attrName}`}
      className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-elevated disabled:opacity-40 transition-colors"
    >
      <X className="h-2.5 w-2.5" strokeWidth={3} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toggle active + delete category row actions
// ---------------------------------------------------------------------------

interface CategoryRowActionsProps {
  categoryId: string;
  active: boolean;
  listingCount: number;
}

export function CategoryRowActions({ categoryId, active, listingCount }: CategoryRowActionsProps) {
  const router = useRouter();
  const [isTogglingActive, startToggle] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggleActive() {
    startToggle(async () => {
      await toggleCategoryActive(categoryId, !active);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this category? This cannot be undone.")) return;
    setError(null);
    startDelete(async () => {
      const result = await deleteCategory(categoryId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to delete");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <AdminActionBar>
        <AdminActionButton
          onClick={handleToggleActive}
          disabled={isTogglingActive}
          tone={active ? "neutral" : "success"}
        >
          {active ? "Deactivate" : "Activate"}
        </AdminActionButton>
        {listingCount === 0 && (
          <AdminActionButton
            onClick={handleDelete}
            disabled={isDeleting}
            tone="danger"
            aria-label="Delete category"
          >
            <Trash2 className="h-3 w-3" />
          </AdminActionButton>
        )}
      </AdminActionBar>
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
