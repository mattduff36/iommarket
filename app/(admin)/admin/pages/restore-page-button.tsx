"use client";

import { useState, useTransition } from "react";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { restoreContentPage } from "@/actions/admin/pages";

interface Props {
  id: string;
}

export function RestorePageButton({ id }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <AdminActionButton
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await restoreContentPage(id);
            if (result.error) {
              setError(typeof result.error === "string" ? result.error : "Failed");
            }
          });
        }}
        disabled={isPending}
        tone="primary"
      >
        {isPending ? "Restoring…" : "Restore"}
      </AdminActionButton>
      {error ? <span className="text-xs text-text-error">{error}</span> : null}
    </span>
  );
}
