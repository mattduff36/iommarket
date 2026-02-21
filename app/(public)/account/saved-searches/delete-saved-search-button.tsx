"use client";

import { useTransition } from "react";
import { deleteSavedSearch } from "@/actions/user-tools";
import { Button } from "@/components/ui/button";

interface Props {
  savedSearchId: string;
}

export function DeleteSavedSearchButton({ savedSearchId }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteSavedSearch({ savedSearchId });
        })
      }
    >
      Delete
    </Button>
  );
}
