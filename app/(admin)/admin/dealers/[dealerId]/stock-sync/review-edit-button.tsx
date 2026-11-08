"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AdminListingEditButton } from "@/components/admin/listing-edit-button";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";

/** Every stock row uses the same trigger, dialog, fields and save interaction. */
export function StockReviewEditButton({ reportId, fingerprint, sourceIdentityKey, listingId = "", override = false }: {
  reportId: string;
  fingerprint: string;
  sourceIdentityKey: string;
  listingId?: string;
  label: string;
  override?: boolean;
}) {
  const router = useRouter();
  const refresh = useStockSnapshotRefresh();
  const target = useMemo(() => ({ reportId, fingerprint, sourceIdentityKey }), [reportId, fingerprint, sourceIdentityKey]);
  return <AdminListingEditButton listingId={listingId} stockReview={target}
    label={override ? "Edit / override" : "Edit"}
    onSaved={() => { if (refresh) refresh(); else router.refresh(); }}
    savedMessage={listingId ? "Listing saved and removed from this review." : "Corrections saved to the review. Review eligibility before approving."} />;
}
