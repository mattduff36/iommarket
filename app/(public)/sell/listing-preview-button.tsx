"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { browserDraftStorage, type DraftScope, type UnsavedDraftSnapshot } from "./listing-unsaved-draft";
import { saveListingPreview } from "./listing-preview-data";

export function ListingPreviewButton({ scope, snapshot, disabled }: {
  scope: DraftScope;
  snapshot: UnsavedDraftSnapshot;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  return <div className="min-w-0">
    <Button asChild variant="ghost" className="h-12 max-w-full whitespace-normal border border-white/30 bg-white/5 px-2 text-xs text-text-primary hover:bg-white/10 sm:px-6 sm:text-sm">
      <a href="/sell/preview" target="_blank" rel="noopener noreferrer" aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) { event.preventDefault(); return; }
          try {
            const storage = browserDraftStorage();
            if (!storage || !scope.userId) throw new Error("Browser storage is unavailable. Your listing has not been submitted.");
            saveListingPreview(storage, scope, snapshot);
            setError(null);
          } catch {
            event.preventDefault();
            setError("The preview could not open. Check your details and browser storage, then try again. Your listing has not been submitted.");
          }
        }}>Preview listing <span className="sr-only">(opens in a new tab)</span></a>
    </Button>
    {error ? <p role="alert" className="mt-2 text-sm text-text-energy">{error}</p> : null}
  </div>;
}
