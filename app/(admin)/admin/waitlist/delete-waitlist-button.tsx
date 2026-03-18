"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs text-text-secondary hidden sm:inline truncate max-w-[120px]" title={email}>
          Delete {email}?
        </span>
        <Button
          type="button"
          variant="energy"
          size="sm"
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? "Deleting…" : "Confirm"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleDeleteClick}
      className="text-text-tertiary hover:text-destructive"
    >
      Delete
    </Button>
  );
}
