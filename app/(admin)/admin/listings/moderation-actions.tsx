"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateListing } from "@/actions/admin";
import { Button } from "@/components/ui/button";

interface Props {
  listingId: string;
  currentStatus: string;
}

export function ModerationActions({ listingId, currentStatus }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAction(action: "APPROVE" | "REJECT" | "TAKE_DOWN") {
    startTransition(async () => {
      await moderateListing({ listingId, action });
      router.refresh();
    });
  }

  return (
    <div className="flex gap-1">
      {(currentStatus === "PENDING" || currentStatus === "DRAFT") && (
        <Button
          size="sm"
          variant="trust"
          onClick={() => handleAction("APPROVE")}
          loading={isPending}
        >
          Approve
        </Button>
      )}
      {currentStatus === "PENDING" && (
        <Button
          size="sm"
          variant="energy"
          onClick={() => handleAction("REJECT")}
          loading={isPending}
        >
          Reject
        </Button>
      )}
      {(currentStatus === "LIVE" || currentStatus === "APPROVED") && (
        <Button
          size="sm"
          variant="energy"
          onClick={() => handleAction("TAKE_DOWN")}
          loading={isPending}
        >
          Take Down
        </Button>
      )}
    </div>
  );
}
