"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { renewListing } from "@/actions/listings";

interface RenewListingButtonProps {
  listingId: string;
  flow?: "private" | "dealer";
  variant?: "default" | "inline";
}

export function RenewListingButton({
  listingId,
  flow = "private",
  variant = "default",
}: RenewListingButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onRenew() {
    setError(null);
    startTransition(async () => {
      const result = await renewListing(listingId);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed to renew listing");
        return;
      }
      router.push(`/sell/checkout?listing=${listingId}&flow=${flow}`);
      router.refresh();
    });
  }

  return (
    <div className={variant === "inline" ? "inline-flex items-center gap-2" : "space-y-2"}>
      <Button
        type="button"
        size={variant === "inline" ? "sm" : "md"}
        variant={variant === "inline" ? "ghost" : "trust"}
        onClick={onRenew}
        disabled={isPending}
      >
        Renew Listing
      </Button>
      {error ? <p className="text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
