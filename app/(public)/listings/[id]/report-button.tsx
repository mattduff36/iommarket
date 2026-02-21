"use client";

import { useState } from "react";
import { reportListing } from "@/actions/listings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";

interface Props {
  listingId: string;
}

export function ReportButton({ listingId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await reportListing({
      listingId,
      reporterEmail: formData.get("email") as string,
      reason: formData.get("reason") as string,
    });

    setLoading(false);
    if (result.error) {
      setError(typeof result.error === "string" ? result.error : "Failed to submit report");
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <p className="text-sm text-text-secondary text-center">
        Report submitted. Thank you.
      </p>
    );
  }

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
        <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-lg border border-border p-4">
          <Input
            label="Your email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
          />
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
              className="flex w-full rounded-sm border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-neon-blue-500 focus:shadow-glow-blue"
            />
          </div>
          {error && <p className="text-xs text-text-error">{error}</p>}
          <Button type="submit" variant="energy" size="sm" loading={loading}>
            Submit Report
          </Button>
        </form>
      )}
    </div>
  );
}
