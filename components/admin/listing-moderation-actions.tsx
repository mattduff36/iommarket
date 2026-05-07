"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateListing, setListingFeatured } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

interface ListingModerationActionsProps {
  listingId: string;
  currentStatus: string;
  featured: boolean;
  variant?: "inline" | "floating";
  className?: string;
}

export function ListingModerationActions({
  listingId,
  currentStatus,
  featured,
  variant = "inline",
  className,
}: ListingModerationActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canApprove = currentStatus === "PENDING" || currentStatus === "DRAFT";
  const canReject = currentStatus === "PENDING";
  const canTakeDown = currentStatus === "LIVE" || currentStatus === "APPROVED";
  const canFeature = currentStatus === "LIVE" || currentStatus === "APPROVED";
  const hasActions = canApprove || canReject || canTakeDown || canFeature;

  if (!hasActions) return null;

  function handleAction(action: "APPROVE" | "REJECT" | "TAKE_DOWN") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await moderateListing({ listingId, action });
        if (result?.error) {
          setError(typeof result.error === "string" ? result.error : "Moderation failed");
          return;
        }
        router.refresh();
      } catch {
        setError("Moderation failed");
      }
    });
  }

  function handleFeatured(nextFeatured: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setListingFeatured({ listingId, featured: nextFeatured });
        if (result?.error) {
          setError(typeof result.error === "string" ? result.error : "Featured update failed");
          return;
        }
        router.refresh();
      } catch {
        setError("Featured update failed");
      }
    });
  }

  return (
    <div
      className={cn(
        variant === "floating"
          ? "fixed right-4 top-24 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-neon-blue-500/40 bg-graphite-950/95 p-3 shadow-2xl shadow-neon-blue-500/10 backdrop-blur-md sm:right-6 sm:w-auto"
          : "flex gap-1",
        className,
      )}
      aria-label="Listing moderation actions"
    >
      {variant === "floating" ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase italic tracking-wide text-text-primary">
              Admin review
            </p>
            <p className="text-xs text-text-secondary">
              Moderate this listing from the preview tab.
            </p>
          </div>
          <Badge variant={currentStatus === "PENDING" ? "warning" : "neutral"}>
            {currentStatus}
          </Badge>
        </div>
      ) : null}

      <div className={cn("flex gap-1", variant === "floating" && "flex-wrap justify-end")}>
        {canApprove ? (
          <Button
            size="sm"
            variant="trust"
            onClick={() => handleAction("APPROVE")}
            loading={isPending}
          >
            Approve
          </Button>
        ) : null}
        {canReject ? (
          <Button
            size="sm"
            variant="energy"
            onClick={() => handleAction("REJECT")}
            loading={isPending}
          >
            Reject
          </Button>
        ) : null}
        {canTakeDown ? (
          <Button
            size="sm"
            variant="energy"
            onClick={() => handleAction("TAKE_DOWN")}
            loading={isPending}
          >
            Take Down
          </Button>
        ) : null}
        {canFeature ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleFeatured(!featured)}
            loading={isPending}
          >
            {featured ? "Unfeature" : "Feature"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-neon-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
