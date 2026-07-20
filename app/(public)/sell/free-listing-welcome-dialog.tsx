"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DISMISSAL_KEY = "iomarket:free-listing-welcome-dismissed";

function hasDismissedFreeListingWelcome(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSAL_KEY) === "true";
  } catch {
    return false;
  }
}

function persistFreeListingWelcomeDismissal() {
  try {
    window.sessionStorage.setItem(DISMISSAL_KEY, "true");
  } catch {
    // The notice remains dismissible when storage is unavailable.
  }
}

export function FreeListingWelcomeDialog() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!hasDismissedFreeListingWelcome()) setIsOpen(true);
  }, []);

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (!nextOpen) persistFreeListingWelcomeDismissal();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] border border-premium-gold-500/35 bg-canvas/95 p-5 shadow-high backdrop-blur sm:max-w-md sm:p-6">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-premium-gold-500/15 ring-1 ring-premium-gold-500/35">
          <Gift aria-hidden className="h-5 w-5 text-premium-gold-500" />
        </div>
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">This listing is free!</DialogTitle>
          <DialogDescription className="leading-6">
            Your first private listing is covered by our launch offer, so you can submit it
            for moderation without paying a listing fee today.
          </DialogDescription>
        </DialogHeader>
        <p className="mt-4 rounded-md border border-border bg-surface/70 px-3 py-2 text-xs leading-5 text-text-secondary">
          Your listing lasts 60 days. Extensions and renewals require payment.
        </p>
        <DialogFooter>
          <Button type="button" variant="premium" onClick={() => handleOpenChange(false)}>
            Start my free listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
