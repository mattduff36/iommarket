"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AdminListingChoiceModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(true);
  }, []);

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose listing type</DialogTitle>
            <DialogDescription>
              As an admin, choose whether you want to create a private listing
              or continue through the dealer flow.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild variant="ghost">
              <Link href="/sell/private">Private listing</Link>
            </Button>
            <Button asChild>
              <Link href="/sell/dealer">Dealer listing</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!open && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <p className="text-sm text-text-secondary">
            Choose how you want to create this listing.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/sell/private">Private listing</Link>
            </Button>
            <Button asChild>
              <Link href="/sell/dealer">Dealer listing</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
