"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markListingAsSold } from "@/actions/listings";
import { Button } from "@/components/ui/button";

export function MarkSoldButton({ listingId }: { listingId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!confirm("Mark this listing as SOLD? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await markListingAsSold(listingId);
      if (!result.error) router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      loading={isPending}
      className="text-premium-gold-400 hover:text-premium-gold-500"
    >
      Mark Sold
    </Button>
  );
}
