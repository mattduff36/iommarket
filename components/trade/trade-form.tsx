"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type TradeActionResult = { error?: string } | { ok?: boolean } | void;

export function TradeForm({
  action,
  submitLabel,
  children,
}: {
  action: (formData: FormData) => Promise<TradeActionResult>;
  submitLabel: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(formData) => {
        startTransition(async () => {
          const result = await action(formData);
          setError(result && typeof result === "object" && "error" in result ? result.error ?? "Trade Exchange could not save that. Try again." : null);
        });
      }}
    >
      {children}
      {error ? <p role="alert" className="text-sm text-text-error">{error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

export const tradeFieldClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary";
