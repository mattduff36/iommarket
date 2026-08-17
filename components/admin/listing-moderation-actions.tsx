"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateListing, setListingFeatured } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";
import { ModerationReasonDialog } from "@/components/admin/moderation-reason-dialog";
import {
  buildModerationReasonOptions,
  MODERATION_TAXONOMY_VERSION,
} from "@/lib/listings/moderation-reasons";
import { cn } from "@/lib/cn";
import type { ListingModerationReason } from "@prisma/client";

interface ListingModerationActionsProps {
  listingId: string;
  currentStatus: string;
  featured: boolean;
  lifecycleRevision: number;
  canReinstateLive?: boolean;
  hasPendingRevision?: boolean;
  pendingRevisionVersion?: number;
  variant?: "inline" | "floating";
  className?: string;
}

const REASON_OPTIONS = buildModerationReasonOptions({
  exclude: ["ACCOUNT_DISABLED"],
});

export function ListingModerationActions({
  listingId,
  currentStatus,
  featured,
  lifecycleRevision,
  canReinstateLive = false,
  hasPendingRevision = false,
  pendingRevisionVersion,
  variant = "inline",
  className,
}: ListingModerationActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | "REJECT"
    | "TAKE_DOWN"
    | "REINSTATE_LIVE"
    | "RETURN_TO_DRAFT"
    | "REJECT_REVISION"
    | null
  >(null);
  const router = useRouter();

  const canApprove = currentStatus === "PENDING";
  const canReject = currentStatus === "PENDING";
  const canApproveRevision = currentStatus === "LIVE" && hasPendingRevision;
  const canTakeDown = currentStatus === "LIVE" || currentStatus === "APPROVED";
  const canRestore = currentStatus === "TAKEN_DOWN" || currentStatus === "REJECTED";
  const canFeature = currentStatus === "LIVE";
  const hasActions =
    canApprove ||
    canReject ||
    canApproveRevision ||
    canTakeDown ||
    canRestore ||
    canFeature;

  if (!hasActions) return null;

  function runAction(
    action:
      | "APPROVE"
      | "REJECT"
      | "TAKE_DOWN"
      | "REINSTATE_LIVE"
      | "RETURN_TO_DRAFT"
      | "APPROVE_REVISION"
      | "REJECT_REVISION",
    reasonCode?: string,
    adminNotes?: string,
    moderationSubReason?: string,
    moderationTaxonomyVersion?: typeof MODERATION_TAXONOMY_VERSION,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await moderateListing({
          listingId,
          action,
          expectedRevision: lifecycleRevision,
          expectedRevisionVersion: pendingRevisionVersion,
          reasonCode: reasonCode as ListingModerationReason | undefined,
          adminNotes,
          moderationSubReason,
          moderationTaxonomyVersion,
        });
        if (result?.error) {
          setError(
            typeof result.error === "string" ? result.error : "Moderation failed",
          );
          if ("conflict" in result && result.conflict) {
            router.refresh();
          }
          return;
        }
        setDialog(null);
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
          : "flex flex-col gap-1",
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
            onClick={() => runAction("APPROVE")}
            disabled={isPending}
          >
            Approve
          </AdminActionButton>
        ) : null}
        {canApproveRevision ? (
          <AdminActionButton
            tone="success"
            onClick={() => runAction("APPROVE_REVISION")}
            disabled={isPending}
          >
            Approve edits
          </AdminActionButton>
        ) : null}
        {canApproveRevision ? (
          <AdminActionButton
            tone="danger"
            onClick={() => setDialog("REJECT_REVISION")}
            disabled={isPending}
          >
            Reject edits
          </AdminActionButton>
        ) : null}
        {canReject ? (
          <AdminActionButton
            tone="danger"
            onClick={() => setDialog("REJECT")}
            disabled={isPending}
          >
            Reject
          </AdminActionButton>
        ) : null}
        {canTakeDown ? (
          <AdminActionButton
            tone="danger"
            onClick={() => setDialog("TAKE_DOWN")}
            disabled={isPending}
          >
            Take Down
          </AdminActionButton>
        ) : null}
        {canRestore && currentStatus === "TAKEN_DOWN" && canReinstateLive ? (
          <AdminActionButton
            tone="success"
            onClick={() => setDialog("REINSTATE_LIVE")}
            disabled={isPending}
          >
            Reinstate live
          </AdminActionButton>
        ) : null}
        {canRestore ? (
          <AdminActionButton
            onClick={() => setDialog("RETURN_TO_DRAFT")}
            disabled={isPending}
          >
            Return to draft
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

      {dialog ? (
        <ModerationReasonDialog
          title={`Confirm ${dialog.replaceAll("_", " ").toLowerCase()}`}
          confirmLabel="Confirm"
          reasons={REASON_OPTIONS}
          pending={isPending}
          onCancel={() => setDialog(null)}
          onConfirm={({
            reasonCode,
            notes,
            moderationSubReason,
            moderationTaxonomyVersion,
          }) =>
            runAction(
              dialog,
              reasonCode,
              notes,
              moderationSubReason,
              moderationTaxonomyVersion,
            )
          }
        />
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-neon-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
