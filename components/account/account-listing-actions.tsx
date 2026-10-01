"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  markListingAsSold,
  renewListing,
  withdrawListingSubmission,
} from "@/actions/listings";
import { AccountConfirmDialog } from "@/components/account/account-confirm-dialog";
import {
  AccountRowActions,
  compactAccountRowActions,
} from "@/components/account/account-row-actions";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { getDraftEditorHref } from "@/lib/listings/draft-editor";

type PendingAction = "sold" | "withdraw" | "renew";

interface AccountListingActionsProps {
  listingId: string;
  title: string;
  status: string;
  featured: boolean;
  dealerId: string | null;
  lifecycleRevision: number;
  hasListingPayment: boolean;
  featuredPurchased?: boolean;
  featuredUpgradePricePence: number;
  checkoutUnavailable: boolean;
}

const CONFIRMATION = {
  sold: {
    title: "Mark as sold",
    description: "Mark this listing as SOLD? This cannot be undone.",
    confirmLabel: "Mark as sold",
    pendingLabel: "Marking sold…",
  },
  withdraw: {
    title: "Withdraw submission",
    description:
      "Withdraw this submission from review? It will return to Draft so you can edit and resubmit it.",
    confirmLabel: "Withdraw submission",
    pendingLabel: "Withdrawing…",
  },
} as const;

function readableActionError(error: unknown, fallback: string) {
  return typeof error === "string" && error.trim() ? error : fallback;
}

export function AccountListingActions({
  listingId,
  title,
  status,
  featured,
  dealerId,
  lifecycleRevision,
  featuredPurchased = false,
  featuredUpgradePricePence,
  checkoutUnavailable,
}: AccountListingActionsProps) {
  const router = useRouter();
  const submitLock = useRef(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirm, setConfirm] = useState<"sold" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editHref = getDraftEditorHref({ listingId, dealerId });
  const canEdit =
    status === "DRAFT" ||
    status === "LIVE" ||
    status === "TAKEN_DOWN" ||
    status === "REJECTED";
  const featuredBenefitOwned = featured || featuredPurchased;
  const showFeaturedPurchase =
    (status === "LIVE" || status === "PENDING") && !featuredBenefitOwned;
  const showFeaturedPending = status === "PENDING" && featuredBenefitOwned;

  async function runAction(kind: PendingAction, task: () => Promise<void>) {
    if (submitLock.current) return;
    submitLock.current = true;
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch {
      setError("That action could not be completed. Please try again.");
    } finally {
      submitLock.current = false;
      setPending(null);
      setConfirm(null);
    }
  }

  function confirmSold() {
    void runAction("sold", async () => {
      const result = await markListingAsSold(listingId);
      if (result.error) {
        setError(
          readableActionError(
            result.error,
            "Could not mark this listing as sold. Please try again.",
          ),
        );
        return;
      }
      setNotice("Marked as sold.");
      router.refresh();
    });
  }

  function confirmWithdraw() {
    void runAction("withdraw", async () => {
      const result = await withdrawListingSubmission({
        listingId,
        expectedRevision: lifecycleRevision,
      });
      if (result.error) {
        setError(result.error);
        if ("conflict" in result && result.conflict) router.refresh();
        return;
      }
      router.push(editHref);
      router.refresh();
    });
  }

  function renew() {
    void runAction("renew", async () => {
      const result = await renewListing(listingId);
      if (result.error) {
        setError(
          readableActionError(result.error, "Could not renew this listing. Please try again."),
        );
        return;
      }
      const flow = dealerId ? "dealer" : "private";
      setNotice("Opening renewal checkout.");
      router.push(`/sell/checkout?listing=${listingId}&flow=${flow}`);
      router.refresh();
    });
  }

  const pendingLabel =
    pending === "sold"
      ? "Marking sold…"
      : pending === "withdraw"
        ? "Withdrawing…"
        : pending === "renew"
          ? "Renewing…"
          : undefined;
  const confirmation = confirm ? CONFIRMATION[confirm] : null;

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showFeaturedPending ? (
          <p className="max-w-64 text-xs text-text-secondary">
            Featured purchased — starts after approval
          </p>
        ) : null}
        {showFeaturedPurchase ? (
          <FeaturedUpgradeButton
            listingId={listingId}
            featuredUpgradePricePence={featuredUpgradePricePence}
            checkoutUnavailable={checkoutUnavailable}
            pendingReview={status === "PENDING"}
            variant="inline"
          />
        ) : null}
        <AccountRowActions
          label={`Actions for ${title}`}
          pendingLabel={pendingLabel}
          actions={compactAccountRowActions([
            {
              kind: "link",
              id: "view",
              label: "View",
              href: `/listings/${listingId}`,
            },
            canEdit
              ? {
                  kind: "link",
                  id: "edit",
                  label: status === "DRAFT" ? "Continue editing" : "Edit",
                  href: editHref,
                }
              : null,
            status === "EXPIRED"
              ? {
                  kind: "command",
                  id: "renew",
                  label: "Renew listing (payment required)",
                  onSelect: renew,
                }
              : null,
            status === "LIVE"
              ? {
                  kind: "command",
                  id: "sold",
                  label: "Mark as sold",
                  destructive: true,
                  onSelect: () => setConfirm("sold"),
                }
              : null,
            status === "PENDING"
              ? {
                  kind: "command",
                  id: "withdraw",
                  label: "Withdraw submission",
                  destructive: true,
                  onSelect: () => setConfirm("withdraw"),
                }
              : null,
          ])}
        />
      </div>
      {error ? (
        <p className="max-w-64 text-xs text-text-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="max-w-64 text-xs text-text-secondary" role="status">
          {notice}
        </p>
      ) : null}
      {confirmation ? (
        <AccountConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          pendingLabel={confirmation.pendingLabel}
          destructive
          pending={pending !== null}
          onConfirm={confirm === "sold" ? confirmSold : confirmWithdraw}
        />
      ) : null}
    </div>
  );
}
