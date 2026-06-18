"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { adminDeleteImage } from "@/actions/admin/media";

interface DeleteImageButtonProps {
  imageId: string;
}

export function DeleteImageButton({ imageId }: DeleteImageButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await adminDeleteImage(imageId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.refresh();
      }
    });
    setShowConfirm(false);
  }

  return (
    <div className="space-y-2">
      {!showConfirm ? (
        <AdminActionButton
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          tone="danger"
        >
          Delete
        </AdminActionButton>
      ) : (
        <AdminActionBar className="rounded-lg border border-neon-red-500/20 bg-neon-red-500/5 p-1.5">
          <AdminActionButton onClick={handleDelete} disabled={isPending} tone="danger">
            Confirm
          </AdminActionButton>
          <AdminActionButton onClick={() => setShowConfirm(false)} disabled={isPending}>
            Cancel
          </AdminActionButton>
        </AdminActionBar>
      )}
      {error && <p className="text-xs text-text-error">{error}</p>}
    </div>
  );
}
