"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StockReviewEditTarget } from "./listing-edit-source";

const ListingEditDialog = dynamic(() => import("./listing-edit-dialog").then(module => module.ListingEditDialog));

export function AdminListingEditButton({ listingId, label = "Open listing editor", onSaved, savedMessage, stockReview }: {
  listingId: string;
  label?: string;
  onSaved?: () => void;
  savedMessage?: string;
  stockReview?: StockReviewEditTarget;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return <div className="mt-2" data-stock-review-editing={open ? "true" : undefined}>
    <Button type="button" variant="ghost" size="sm" className="border border-border px-3 text-sm text-text-primary" onClick={() => setOpen(true)}>{label}</Button>
    {open && <ListingEditDialog listingId={listingId} stockReview={stockReview} open={open} onOpenChange={setOpen} onSaved={() => { setSaved(true); onSaved?.(); }} />}
    {saved && savedMessage && <p role="status" className="mt-2 text-sm text-text-secondary">{savedMessage}</p>}
  </div>;
}
