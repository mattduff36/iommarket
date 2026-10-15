"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { tradeListingStatusAction } from "@/actions/trade/listings";
import { tradeEnquiryStatusAction } from "@/actions/trade/enquiries";
import { Button } from "@/components/ui/button";

const UPDATE_ERROR = "Trade Exchange could not update that. Try again.";

type ActionResult = { error?: string; ok?: boolean } | void;

function readOutcome(result: ActionResult, successMessage: string) {
  if (result && typeof result === "object" && "error" in result) {
    return { error: result.error || UPDATE_ERROR, success: null };
  }
  if (result && typeof result === "object" && result.ok === true) {
    return { error: null, success: successMessage };
  }
  return { error: UPDATE_ERROR, success: null };
}

function StatusActions({
  actions,
  successMessage,
  onAction,
}: {
  actions: Array<{ status: string; label: string }>;
  successMessage: string;
  onAction: (status: string) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const busy = pending && pendingStatus === action.status;
        return (
          <Button
            key={action.status}
            type="button"
            variant="ghost"
            loading={busy}
            disabled={pending}
            onClick={() => {
              setError(null);
              setSuccess(null);
              setPendingStatus(action.status);
              startTransition(async () => {
                try {
                  const result = await onAction(action.status);
                  const next = readOutcome(result, successMessage);
                  setError(next.error);
                  setSuccess(next.success);
                } catch (caught) {
                  unstable_rethrow(caught);
                  setSuccess(null);
                  setError(UPDATE_ERROR);
                } finally {
                  setPendingStatus(null);
                }
              });
            }}
          >
            {busy ? "Updating…" : action.label}
          </Button>
        );
      })}
      <div className="w-full" aria-live="polite" aria-atomic="true">
        {error ? <p role="alert" className="text-sm text-text-error">{error}</p> : null}
        {success ? <p role="status" className="text-sm text-emerald-500">{success}</p> : null}
      </div>
    </div>
  );
}

export function TradeListingActions({
  listingId,
  actions,
}: {
  listingId: string;
  actions: Array<{ status: "RESERVED" | "LIVE" | "SOLD" | "WITHDRAWN" | "REMOVED"; label: string }>;
}) {
  return (
    <StatusActions
      actions={actions}
      successMessage="Listing updated."
      onAction={(status) => tradeListingStatusAction(listingId, status as "RESERVED" | "LIVE" | "SOLD" | "WITHDRAWN" | "REMOVED")}
    />
  );
}

export function TradeEnquiryActions({
  enquiryId,
  actions,
}: {
  enquiryId: string;
  actions: Array<{ status: "WITHDRAWN" | "DECLINED" | "ACCEPTED_IN_PRINCIPLE" | "CLOSED"; label: string }>;
}) {
  return (
    <StatusActions
      actions={actions}
      successMessage="Enquiry updated."
      onAction={(status) => tradeEnquiryStatusAction(
        enquiryId,
        status as "WITHDRAWN" | "DECLINED" | "ACCEPTED_IN_PRINCIPLE" | "CLOSED",
      )}
    />
  );
}
