"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateListing, setListingFeatured } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
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

      <AdminActionBar className={cn(variant === "floating" && "justify-end")}>
        {canApprove ? (
          <AdminActionButton
            tone="success"
            onClick={() => handleAction("APPROVE")}
            disabled={isPending}
          >
            Approve
          </AdminActionButton>
        ) : null}
        {canReject ? (
          <AdminActionButton
            tone="danger"
            onClick={() => handleAction("REJECT")}
            disabled={isPending}
          >
            Reject
          </AdminActionButton>
        ) : null}
        {canTakeDown ? (
          <AdminActionButton
            tone="danger"
            onClick={() => handleAction("TAKE_DOWN")}
            disabled={isPending}
          >
            Take Down
          </AdminActionButton>
        ) : null}
        {canFeature ? (
          <AdminActionButton
            onClick={() => handleFeatured(!featured)}
            disabled={isPending}
            tone={featured ? "neutral" : "primary"}
          >
            {featured ? "Unfeature" : "Feature"}
          </AdminActionButton>
        ) : null}
      </AdminActionBar>

      {error ? (
        <p className="mt-2 text-xs text-neon-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
