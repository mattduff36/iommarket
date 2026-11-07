"use client";

import { useId, useState } from "react";
import { stockSyncReason } from "@/lib/dealer-stock-sync/review";
import { stockReviewHelp } from "@/lib/dealer-stock-sync/review-help";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

export function StockReviewReason({ action }: { action: PlanAction }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (action.kind !== "blocked" && action.kind !== "conflict") return null;
  const reason = stockSyncReason(action.reason);
  return (
    <div className="text-text-secondary" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <p>{reason}{" "}
        <button type="button" aria-label={`Explain: ${reason}`} aria-describedby={open ? id : undefined}
          aria-expanded={open} aria-controls={open ? id : undefined}
          className="min-h-11 rounded px-2 text-neon-blue-400 underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-blue-400"
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
          Why? / Next steps
        </button>
      </p>
      {open && <div id={id} role="tooltip" className="my-2 max-w-prose rounded-md border border-border bg-surface-secondary p-3 text-sm leading-relaxed text-text-primary">
        {stockReviewHelp(action)}
      </div>}
    </div>
  );
}
