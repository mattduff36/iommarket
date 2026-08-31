"use client";

import { useState } from "react";
import { reportListing } from "@/actions/listings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { AlertTriangle } from "lucide-react";
import {
  firstFieldError,
  flattenZodFieldErrors,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { REPORT_REASON_CODES, reportListingSchema } from "@/lib/validations/listing";

interface Props {
  listingId: string;
}

export function ReportButton({ listingId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    const payload = {
      listingId,
      reporterEmail: String(formData.get("email") ?? ""),
      reasonCode: String(formData.get("reasonCode") ?? "") as (typeof REPORT_REASON_CODES)[number],
      reason: String(formData.get("reason") ?? ""),
    };
    const parsed = reportListingSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(flattenZodFieldErrors(parsed.error));
      setLoading(false);
      return;
    }

    const result = await reportListing(parsed.data);

    setLoading(false);
    if (result.error) {
      const split = splitActionError(result.error);
      setFieldErrors(split.fieldErrors);
      setError(split.formError);
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <p className="text-sm text-text-secondary text-center">
        Report submitted. Thank you.
      </p>
    );
  }

  const reasonError = firstFieldError(fieldErrors, "reason");
  const reasonCodeError = firstFieldError(fieldErrors, "reasonCode");

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-error transition-colors"
      >
        <AlertTriangle className="h-3 w-3" />
        Report this listing
      </button>

      {open && (
        <form onSubmit={handleSubmit} noValidate className="mt-3 space-y-3 rounded-lg border border-border p-4">
          <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
          <Input
            label="Your email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            error={firstFieldError(fieldErrors, "reporterEmail")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="reasonCode" className="text-sm font-medium text-text-primary">
              Category
            </label>
            <select
              id="reasonCode"
              name="reasonCode"
              required
              aria-invalid={reasonCodeError ? true : undefined}
              className="flex h-10 w-full rounded-sm border border-border bg-surface-elevated px-3 text-sm"
              defaultValue="FRAUD"
            >
              <option value="FRAUD">Fraud or scam</option>
              <option value="PROHIBITED">Prohibited item</option>
              <option value="MISLEADING">Misleading</option>
              <option value="DUPLICATE">Duplicate</option>
              <option value="POLICY">Policy</option>
              <option value="SAFETY">Safety</option>
              <option value="OTHER">Other</option>
            </select>
            {reasonCodeError ? (
              <p className="text-xs text-text-error">{reasonCodeError}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="reason" className="text-sm font-medium text-text-primary">
              Reason
            </label>
            <textarea
              id="reason"
              name="reason"
              required
              rows={3}
              minLength={10}
              placeholder="Please describe the issue..."
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? "report-reason-error" : undefined}
              className={[
                "flex w-full rounded-sm border bg-surface-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-neon-blue-500 focus:shadow-glow-blue",
                reasonError ? "border-neon-red-500" : "border-border",
              ].join(" ")}
            />
            {reasonError ? (
              <p id="report-reason-error" className="text-xs text-text-error">
                {reasonError}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="energy" size="sm" loading={loading}>
            Submit Report
          </Button>
        </form>
      )}
    </div>
  );
}
