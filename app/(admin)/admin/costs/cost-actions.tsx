"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordManualProjectCost,
  requestProjectInvoice,
  retryProjectCostEmail,
  runManualCostSync,
} from "@/actions/admin/costs";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { Input } from "@/components/ui/input";

function actionError(result: { error?: unknown } | { data: unknown }): string | null {
  if ("error" in result && result.error) {
    return typeof result.error === "string"
      ? result.error
      : Object.values(result.error as Record<string, string[] | undefined>)
          .flat()
          .filter(Boolean)
          .join(", ") || "Request failed.";
  }
  return null;
}

export function RequestInvoiceButton({
  label,
  disabled,
}: {
  label: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <AdminActionBar>
        <AdminActionButton
          tone="primary"
          disabled={disabled || isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await requestProjectInvoice();
              const nextError = actionError(result);
              if (nextError) {
                setError(nextError);
                return;
              }
              router.refresh();
            });
          }}
        >
          {isPending ? "Requesting…" : label}
        </AdminActionButton>
      </AdminActionBar>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
    </div>
  );
}

export function OwnerCostControls({
  canRetryEmail,
  outboxId,
}: {
  canRetryEmail: boolean;
  outboxId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleManual(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordManualProjectCost({
        category: String(formData.get("category") ?? "CURSOR") as "CURSOR" | "OTHER",
        externalRef: String(formData.get("externalRef") ?? ""),
        nativeAmount: String(formData.get("nativeAmount") ?? ""),
        nativeCurrency: String(formData.get("nativeCurrency") ?? "USD") as "USD" | "GBP",
        displayLabel: String(formData.get("displayLabel") ?? ""),
        periodStart: new Date(String(formData.get("periodStart") ?? "")).toISOString(),
        periodEnd: new Date(String(formData.get("periodEnd") ?? "")).toISOString(),
      });
      const nextError = actionError(result);
      if (nextError) {
        setError(nextError);
        return;
      }
      setSuccess("Cost recorded.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form action={handleManual} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Category</span>
          <select
            name="category"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            defaultValue="CURSOR"
          >
            <option value="CURSOR">Development</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Currency</span>
          <select
            name="nativeCurrency"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            defaultValue="USD"
          >
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
        <Input name="externalRef" label="External reference" required />
        <Input name="nativeAmount" label="Source amount" required />
        <Input name="displayLabel" label="Label" required />
        <Input name="periodStart" label="Period start" type="datetime-local" required />
        <Input name="periodEnd" label="Period end" type="datetime-local" required />
        <AdminActionBar className="sm:col-span-2">
          <AdminActionButton type="submit" tone="primary" disabled={isPending}>
            Record cost
          </AdminActionButton>
          <AdminActionButton
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await runManualCostSync();
                const nextError = actionError(result);
                if (nextError) {
                  setError(nextError);
                  return;
                }
                setSuccess("Synchronization finished.");
                router.refresh();
              });
            }}
          >
            Refresh provider costs
          </AdminActionButton>
          {canRetryEmail && outboxId ? (
            <AdminActionButton
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await retryProjectCostEmail({ outboxId });
                  const nextError = actionError(result);
                  if (nextError) {
                    setError(nextError);
                    return;
                  }
                  setSuccess("Email retry sent.");
                  router.refresh();
                });
              }}
            >
              Retry invoice email
            </AdminActionButton>
          ) : null}
        </AdminActionBar>
      </form>
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-500">{success}</p> : null}
    </div>
  );
}
