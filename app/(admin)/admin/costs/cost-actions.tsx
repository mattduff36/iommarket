"use client";

import { useState, useTransition } from "react";
import {
  addManualCostCategory,
  recordManualProjectCost,
  requestProjectInvoice,
  retryProjectCostEmail,
} from "@/actions/admin/costs";
import type { ManualCostCategory } from "@/lib/costs/manual-categories";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { Input } from "@/components/ui/input";
import { useRefreshPage } from "./use-refresh-page";

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
  const refreshPage = useRefreshPage();
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
              refreshPage();
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
  categories,
  outboxId,
}: {
  canRetryEmail: boolean;
  categories: ManualCostCategory[];
  outboxId?: string;
}) {
  const refreshPage = useRefreshPage();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [categorySlug, setCategorySlug] = useState(categories[0]?.slug ?? "");
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");

  function handleManual(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordManualProjectCost({
        categorySlug,
        nativeAmount: String(formData.get("nativeAmount") ?? ""),
        nativeCurrency: String(formData.get("nativeCurrency") ?? "GBP") as "USD" | "GBP",
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
      refreshPage();
    });
  }

  function addCategory() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await addManualCostCategory({ label: categoryName });
      const nextError = actionError(result);
      if (nextError || !("data" in result) || !result.data) {
        if (nextError) setError(nextError);
        return;
      }
      setCategoryOptions(result.data.categories);
      setCategorySlug(result.data.category.slug);
      setCategoryName("");
      setAddingCategory(false);
      setSuccess("Category added.");
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Record a manual cost</h3>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Add a charge or a reduction. A minus sign reduces the total.
          The period is used to group it in the dashboard.
        </p>
      </div>
      <form action={handleManual} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor="manual-cost-category">
          <span className="font-medium text-text-primary">Category</span>
          <select
            id="manual-cost-category"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={addingCategory ? "__add__" : categorySlug}
            onChange={(event) => {
              if (event.target.value === "__add__") {
                setAddingCategory(true);
                return;
              }
              setAddingCategory(false);
              setCategorySlug(event.target.value);
            }}
          >
            {categoryOptions.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
            <option value="__add__">Add category…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="manual-cost-currency">
          <span className="font-medium text-text-primary">Currency</span>
          <select
            id="manual-cost-currency"
            name="nativeCurrency"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            defaultValue="GBP"
          >
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
          </select>
        </label>
        {addingCategory ? (
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-end">
            <Input
              name="newCategory"
              label="New category"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <AdminActionButton type="button" disabled={isPending || categoryName.trim().length < 2} onClick={addCategory}>
              Add category
            </AdminActionButton>
          </div>
        ) : null}
        <Input
          name="nativeAmount"
          label="Amount"
          helperText="Positive adds a cost. A minus sign records a reduction."
          required
        />
        <Input name="displayLabel" label="Label" required />
        <Input name="periodStart" label="Period start" type="datetime-local" required />
        <Input name="periodEnd" label="Period end" type="datetime-local" required />
        <AdminActionBar className="border-t border-border pt-4 sm:col-span-2">
          <AdminActionButton type="submit" tone="primary" disabled={isPending || addingCategory || !categorySlug}>
            Record cost
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
                  refreshPage();
                });
              }}
            >
              Retry invoice email
            </AdminActionButton>
          ) : null}
        </AdminActionBar>
      </form>
      <div aria-live="polite" className="min-h-5">
        {error ? <p role="alert" className="text-sm text-text-error">{error}</p> : null}
        {success ? <p role="status" className="text-sm text-emerald-500">{success}</p> : null}
      </div>
    </div>
  );
}
