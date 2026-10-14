"use client";

import { useState, useTransition } from "react";
import { tradeListingStatusAction } from "@/actions/trade/listings";
import { tradeEnquiryStatusAction } from "@/actions/trade/enquiries";
import { Button } from "@/components/ui/button";

export function TradeListingActions({
  listingId,
  actions,
}: {
  listingId: string;
  actions: Array<{ status: "RESERVED" | "LIVE" | "SOLD" | "WITHDRAWN" | "REMOVED"; label: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.status}
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await tradeListingStatusAction(listingId, action.status);
            setError("error" in result ? result.error ?? null : null);
          })}
        >
          {action.label}
        </Button>
      ))}
      {error ? <p role="alert" className="w-full text-sm text-text-error">{error}</p> : null}
    </div>
  );
}

export function TradeEnquiryActions({
  enquiryId,
  actions,
}: {
  enquiryId: string;
  actions: Array<{ status: "WITHDRAWN" | "DECLINED" | "ACCEPTED_IN_PRINCIPLE" | "CLOSED"; label: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.status}
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await tradeEnquiryStatusAction(enquiryId, action.status);
            setError(result && "error" in result ? result.error ?? null : null);
          })}
        >
          {action.label}
        </Button>
      ))}
      {error ? <p role="alert" className="w-full text-sm text-text-error">{error}</p> : null}
    </div>
  );
}
