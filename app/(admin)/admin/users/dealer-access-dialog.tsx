"use client";

import { useMemo, useState, useTransition } from "react";
import {
  grantDealerAccess,
  setUserRole,
} from "@/actions/admin/users";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DealerAccessDialogProps {
  userId: string;
  userLabel: string;
  mode: "promote" | "grant";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

const DURATION_OPTIONS = [30, 60, 90, 180, 365] as const;
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 3_650;

export function DealerAccessDialog({
  userId,
  userLabel,
  mode,
  open,
  onOpenChange,
  onCompleted,
}: DealerAccessDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedDuration, setSelectedDuration] = useState<number | "custom">(30);
  const [customDuration, setCustomDuration] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const durationDays =
    selectedDuration === "custom" ? Number(customDuration) : selectedDuration;
  const isDurationValid =
    Number.isInteger(durationDays) &&
    durationDays >= MIN_DURATION_DAYS &&
    durationDays <= MAX_DURATION_DAYS;
  const expiresAt = useMemo(
    () =>
      isDurationValid
        ? new Date(Date.now() + durationDays * 86_400_000)
        : null,
    [durationDays, isDurationValid]
  );
  const actionLabel = mode === "promote" ? "Promote to dealer" : "Grant free access";

  function resetDialog() {
    setSelectedDuration(30);
    setCustomDuration("30");
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!isPending && !nextOpen) resetDialog();
    onOpenChange(nextOpen);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isDurationValid) {
      setError(
        `Enter a whole number of days between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS}.`
      );
      return;
    }

    setError(null);
    startTransition(async () => {
      const result =
        mode === "promote"
          ? await setUserRole({
              userId,
              role: "DEALER",
              grantDurationDays: durationDays,
            })
          : await grantDealerAccess({ userId, durationDays });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Unable to update dealer access. Check the duration and try again."
        );
        return;
      }

      handleOpenChange(false);
      onCompleted();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>
            {mode === "promote"
              ? `${userLabel} will become a dealer with complimentary access.`
              : `Give ${userLabel} complimentary dealer access.`}{" "}
            No payment will be taken or recorded.
          </DialogDescription>
        </DialogHeader>

        <form className="mt-5" onSubmit={handleSubmit}>
          <fieldset disabled={isPending}>
            <legend className="text-sm font-medium text-text-primary">
              Free access duration
            </legend>
            <p className="mt-1 text-xs text-text-secondary">
              Select how long access should last. The server calculates the final
              UTC expiry time when you confirm.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DURATION_OPTIONS.map((days) => {
                const isSelected = selectedDuration === days;
                return (
                  <label
                    key={days}
                    className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? "border-neon-blue-500 bg-neon-blue-500/10 text-text-primary"
                        : "border-border bg-canvas/40 text-text-secondary hover:border-border-focus"
                    }`}
                  >
                    <span>{days} days</span>
                    <input
                      className="sr-only"
                      type="radio"
                      name="duration"
                      value={days}
                      checked={isSelected}
                      onChange={() => setSelectedDuration(days)}
                    />
                    <span aria-hidden="true">{isSelected ? "✓" : ""}</span>
                  </label>
                );
              })}
              <label
                className={`col-span-2 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors sm:col-span-3 ${
                  selectedDuration === "custom"
                    ? "border-neon-blue-500 bg-neon-blue-500/10 text-text-primary"
                    : "border-border bg-canvas/40 text-text-secondary hover:border-border-focus"
                }`}
              >
                <input
                  type="radio"
                  name="duration"
                  value="custom"
                  checked={selectedDuration === "custom"}
                  onChange={() => setSelectedDuration("custom")}
                />
                <span>Custom duration</span>
                <input
                  aria-label="Custom access duration in days"
                  className="ml-auto h-8 w-24 rounded border border-border bg-surface px-2 text-sm text-text-primary disabled:opacity-50"
                  type="number"
                  min={MIN_DURATION_DAYS}
                  max={MAX_DURATION_DAYS}
                  step="1"
                  value={customDuration}
                  disabled={selectedDuration !== "custom"}
                  onChange={(event) => setCustomDuration(event.target.value)}
                />
                <span>days</span>
              </label>
            </div>
          </fieldset>

          <div className="mt-4 rounded-md border border-border bg-canvas/40 p-3 text-sm">
            <p className="font-medium text-text-primary">Complimentary dealer access</p>
            <p className="mt-1 text-text-secondary">
              {expiresAt
                ? `Expires ${expiresAt.toLocaleDateString("en-GB", {
                    timeZone: "UTC",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })} (UTC).`
                : "Choose a valid duration to calculate the expiry date."}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Paid subscriptions always take precedence and will not be changed.
            </p>
          </div>

          {error ? (
            <p aria-live="polite" className="mt-3 text-sm text-text-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-md border border-border px-4 text-sm text-text-secondary hover:bg-surface-elevated disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !isDurationValid}
              className="h-9 rounded-md bg-neon-blue-500 px-4 text-sm font-medium text-canvas hover:bg-neon-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving…" : actionLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
