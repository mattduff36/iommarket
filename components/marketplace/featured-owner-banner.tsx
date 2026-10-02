"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FeaturedUpgradeButton } from "@/components/marketplace/featured-upgrade-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatGbpFromPence } from "@/lib/formatting/gbp";

/**
 * Owner-only Featured offer. Mount this only for the signed-in owner when the
 * listing is PENDING or LIVE and is not already featured or covered by a
 * succeeded Featured payment.
 */
interface FeaturedOwnerBannerProps {
  listingId: string;
  featuredUpgradePricePence: number;
  checkoutUnavailable?: boolean;
  pendingReview?: boolean;
}

export function featuredOwnerBannerStorageKey(listingId: string) {
  return `itrader.featured-owner-banner.v1:${listingId}`;
}

function readDismissed(listingId: string) {
  try {
    return window.localStorage.getItem(featuredOwnerBannerStorageKey(listingId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(listingId: string) {
  try {
    window.localStorage.setItem(featuredOwnerBannerStorageKey(listingId), "1");
  } catch {
    // Dismissal still applies for this view when storage is unavailable.
  }
}

export function FeaturedOwnerBanner({
  listingId,
  featuredUpgradePricePence,
  checkoutUnavailable = false,
  pendingReview = false,
}: FeaturedOwnerBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const price = formatGbpFromPence(featuredUpgradePricePence);

  useEffect(() => {
    setDismissed(readDismissed(listingId));
  }, [listingId]);

  function dismiss() {
    setDismissed(true);
    writeDismissed(listingId);
    setDialogOpen(true);
  }

  return (
    <>
      {!dismissed && (
      <aside
      aria-label="Feature this listing"
      className="relative rounded-lg border border-premium-gold-500/30 bg-premium-gold-500/5 p-4"
    >
      <button
        type="button"
        aria-label="Dismiss featured offer"
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="space-y-3 pr-8">
        <p className="text-sm font-semibold text-premium-gold-400">Feature this listing</p>
        <p className="text-sm text-text-secondary">
          Featured placement costs {price}
          {pendingReview
            ? " and starts after the listing is approved"
            : " and starts once payment is confirmed"}.
        </p>
        <FeaturedUpgradeButton
          listingId={listingId}
          featuredUpgradePricePence={featuredUpgradePricePence}
          checkoutUnavailable={checkoutUnavailable}
          pendingReview={pendingReview}
          variant="inline"
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
          How to upgrade later
        </Button>
      </div>
      </aside>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Upgrade later</DialogTitle>
            <DialogDescription className="text-base text-text-primary">
              You can buy Featured later from My listings while this listing is awaiting review
              or live.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Open My listings, find this listing, and choose Feature. Placement starts after the
            listing is approved.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" className="w-full sm:w-auto sm:min-w-24">
                OK
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
