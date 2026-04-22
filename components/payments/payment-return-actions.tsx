"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PaymentReturnActionsProps {
  returnHref: string;
  status: "success" | "cancel";
  context: "listing" | "featured" | "subscription";
  listingId?: string;
}

export function PaymentReturnActions({
  returnHref,
  status,
  context,
  listingId,
}: PaymentReturnActionsProps) {
  useEffect(() => {
    const payload = JSON.stringify({
      status,
      context,
      listingId,
      at: Date.now(),
    });

    window.localStorage.setItem("iomarket-payment-return", payload);
  }, [context, listingId, status]);

  function handleCloseTab() {
    window.close();
  }

  return (
    <div className="flex flex-col gap-3">
      <Button asChild>
        <Link href={returnHref}>Return to itrader</Link>
      </Button>
      <Button variant="ghost" onClick={handleCloseTab}>
        Close this tab
      </Button>
    </div>
  );
}
