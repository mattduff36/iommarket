"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminRowActions } from "@/components/admin/admin-row-actions";
import { adminDeleteImage } from "@/actions/admin/media";

interface DeleteImageButtonProps {
  imageId: string;
  listingTitle?: string;
}

function readError(error: unknown, fallback: string) {
  return typeof error === "string" ? error : fallback;
}

export function DeleteImageButton({
  imageId,
  listingTitle = "this listing",
}: DeleteImageButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDelete() {
    setError(null);
    setPendingLabel("Deleting…");
    startTransition(async () => {
      try {
        const result = await adminDeleteImage(imageId);
        if (result.error) {
          setError(readError(result.error, "Failed to delete image"));
          return;
        }
        setConfirmDelete(false);
        router.refresh();
      } finally {
        setPendingLabel(null);
      }
    });
  }

  return (
    <div className="space-y-2">
      <AdminRowActions
        label={`Actions for ${listingTitle}`}
        actions={[
          {
            kind: "command",
            id: "delete",
            label: "Delete image",
            destructive: true,
            onSelect: () => setConfirmDelete(true),
          },
        ]}
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
        title={`Delete the image for ${listingTitle}?`}
        description="This removes the image from the listing."
        confirmLabel="Delete image"
        destructive
        pending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
