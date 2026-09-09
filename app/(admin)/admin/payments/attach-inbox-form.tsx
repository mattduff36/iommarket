"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminAttachUnmatchedListing } from "@/actions/admin/payments";
import {
  AdminActionBar,
  AdminActionButton,
} from "@/components/admin/admin-action-controls";

export function AttachInboxForm({ inboxId }: { inboxId: string }) {
  const router = useRouter();
  const [listingId, setListingId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAttach() {
    setError(null);
    startTransition(async () => {
      const result = await adminAttachUnmatchedListing({
        inboxId,
        listingId: listingId.trim(),
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Could not attach this inbox row.",
        );
        return;
      }
      setListingId("");
      setConfirmed(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-text-secondary">
        Listing ID
        <input
          value={listingId}
          onChange={(event) => setListingId(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I confirm this inbox row is the listing fee for that listing
      </label>
      <AdminActionBar>
        <AdminActionButton
          onClick={handleAttach}
          disabled={!confirmed || listingId.trim().length === 0 || isPending}
        >
          Attach to listing
        </AdminActionButton>
      </AdminActionBar>
      {error ? <p className="text-xs text-text-error">{error}</p> : null}
    </div>
  );
}
