"use client";

import { useState, useTransition } from "react";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { restoreWaitlistUser } from "@/actions/waitlist";

interface Props {
  id: string;
}

export function RestoreWaitlistButton({ id }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <AdminActionButton
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await restoreWaitlistUser(id);
            if (result.error) setError(result.error);
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
