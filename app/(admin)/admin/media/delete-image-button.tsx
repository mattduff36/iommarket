"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
    <div className="flex items-center gap-1">
      {!showConfirm ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowConfirm(true)}
          disabled={isPending}
          className="text-xs text-neon-red-400"
        >
          Delete
        </Button>
      ) : (
        <>
          <Button size="sm" variant="ghost" onClick={handleDelete} disabled={isPending} className="text-xs text-neon-red-400">
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)} disabled={isPending} className="text-xs">
            Cancel
          </Button>
        </>
      )}
      {error && <span className="text-xs text-text-error">{error}</span>}
    </div>
  );
}
