"use client";

import { ReportableError } from "@/components/monitoring/reportable-error";
import { useState, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type TradeActionResult = { error?: string } | { ok?: boolean } | void;

const SAVE_ERROR = "Trade Exchange could not save that. Try again.";

function TradeSubmitButton({
  label,
  variant,
}: {
  label: string;
  variant?: ButtonProps["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={pending} aria-disabled={pending || undefined}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function TradeForm({
  action,
  submitLabel,
  children,
  successMessage = "Saved.",
  variant,
  className,
}: {
  action: (formData: FormData) => Promise<TradeActionResult>;
  submitLabel: string;
  children: ReactNode;
  successMessage?: string;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <form
      className={cn("space-y-4", className)}
      action={async (formData) => {
        setError(null);
        setSuccess(null);
        try {
          const result = await action(formData);
          if (result && typeof result === "object" && "error" in result && result.error) {
            setSuccess(null);
            setError(result.error);
            return;
          }
          setError(null);
          setSuccess(successMessage);
        } catch (caught) {
          unstable_rethrow(caught);
          setSuccess(null);
          setError(SAVE_ERROR);
        }
      }}
    >
      {children}
      <div aria-live="polite" aria-atomic="true">
        {error ? <ReportableError as="p" role="alert" className="text-sm text-text-error">{error}</ReportableError> : null}
        {success ? <p role="status" className="text-sm text-emerald-500">{success}</p> : null}
      </div>
      <TradeSubmitButton label={submitLabel} variant={variant} />
    </form>
  );
}

export { tradeFieldClass } from "@/components/trade/trade-styles";
