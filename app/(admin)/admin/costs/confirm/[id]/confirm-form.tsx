"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmProjectInvoice } from "@/actions/admin/costs";
import { AdminActionButton } from "@/components/admin/admin-action-controls";

export function ConfirmInvoiceForm({
  requestId,
  amountLabel,
}: {
  requestId: string;
  amountLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <AdminActionButton
        tone="primary"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await confirmProjectInvoice({ requestId });
            if ("error" in result && result.error) {
              setError(
                typeof result.error === "string"
                  ? result.error
                  : "Failed to confirm the invoice request.",
              );
              return;
            }
            router.refresh();
          });
        }}
      >
        {isPending ? "Confirming…" : `Confirm invoice for ${amountLabel}`}
      </AdminActionButton>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
    </div>
  );
}
