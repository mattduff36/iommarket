import type { PlanAction } from "./types";

const guidance: Record<string, string> = {
  "status-preserved": "The linked listing is not LIVE, so the stock check preserves its current status instead of updating or removing it. Open the listing editor to check its status and any approval requirements. Only restore it if the dealer confirms it should be advertised, then run a fresh stock check.",
  "paid-feature": "This listing is missing from the latest complete website check, but it is featured, so automatic removal is blocked. Missing from a website does not prove it has sold. Open the listing editor, confirm availability with the dealer and review the featured placement before making a manual status change.",
  "unmapped": "A previously tracked website reference is missing from the latest complete check and has no matching listing in this review. It is retained for reconciliation; there is no linked listing to remove. Search the dealer website and existing listings using the source reference. If the vehicle returns, run a fresh check; if the reference is obsolete, you can dismiss this review item. Dismissing it does not delete the saved tracking record, so it may appear again.",
  "dealer-edited": "The current listing values differ from the last imported baseline. Applying website values could overwrite a manual edit. Compare the proposed changes with the listing editor and confirm the intended values before proceeding.",
  "absent-baseline": "There are no previous imported values to safely compare with this listing. This check records a baseline without overwriting it. Run another complete stock check, then review any proposed differences.",
  "pending-revision": "This listing already has changes awaiting review. Resolve those changes in the listing editor first, then run a fresh check so the stock update does not compete with the pending revision.",
  "manual-taken-down": "This listing was taken down. A stock check must not reverse that decision automatically. Open the listing editor, investigate the takedown and confirm permission before restoring it.",
  "sold-preserved": "The listing is already marked sold and its status is preserved. Verify any correction manually in the listing editor; a website check does not relist sold vehicles.",
  "source-sold": "The dealer website marks this vehicle as sold. Confirm availability with the dealer and review the existing listing manually; do not import it as available stock.",
  "preview-listing": "This listing belongs to a preview pack and is protected from normal stock updates. Review it through the preview workflow rather than changing live stock from this result.",
  "confirm-vehicle-category": "The scraped category needs an admin decision. Use the review editor to choose the correct vehicle category, check the required fields and save the correction before approval.",
  "supply-owned-photos": "The listing needs at least two valid uploaded vehicle photos. A source website URL alone is not an uploaded photo. Add suitable photos in the review editor and save before approval.",
  "images-not-owned": "The scrape did not provide usable photos for this vehicle. Check the source listing and supply valid photos through the available editor before importing. Do not assume a missing photo means the vehicle has sold.",
  "missing-region": "The dealer has no configured location for new listings. Set the dealer location, then run a fresh check to produce a valid import proposal.",
  "source-transmission-conflict": "The title and specification describe different transmissions. Check the original advert and confirm with the dealer, then correct the review details before approving an import.",
  "unmapped-existing-stock": "Existing dealer listings have not been reliably linked to website references. Adding these vehicles could create duplicates. Compare existing listings with the website and resolve the matching before running another check.",
  "duplicate-source": "Multiple website records use the same vehicle identity with conflicting information. Check the source adverts and have the duplicate or incorrect reference corrected before retrying.",
  "duplicate-managed-listing": "More than one managed listing uses this vehicle reference. Review those listings and resolve the duplicate mapping before retrying; the check cannot safely choose one.",
  "unstable-identity": "No reliable vehicle reference is available to track this vehicle between checks. Verify the source advert and correct the source identity before importing to avoid duplicates or incorrect removals.",
  "identity-uncertain": "Missing or conflicting website references prevent a reliable stock comparison. Check the scan diagnostics and source records, resolve the identity problem and run another complete check. Existing listings remain protected.",
  "source-failed": "At least one required website section could not be read. Retry the stock check and inspect its diagnostics if it fails again. An incomplete check must not be treated as evidence that vehicles were removed.",
  "submission-invalid": "The submitted scan did not pass validation. Update the Stock Update app and run a fresh check. If it repeats, report the scan diagnostics; do not work around the validation by approving incomplete data.",
  "pagination-uncertain": "The scan could not verify that all stock pages were read. Check the dealer website and scan diagnostics, then retry. Missing vehicles cannot safely be counted from this incomplete result.",
  "detail-uncertain": "Some individual vehicle pages could not be verified. Inspect the source adverts and retry the check before relying on the result to update or remove stock.",
  "partial-inventory": "The scan found fewer vehicles than the website reports. Check pagination, filters and website availability, then retry. This result does not establish that the other vehicles have left stock.",
  "zero-inventory": "No vehicles were returned. This could indicate an empty website or a failed extraction. Verify the dealer website and retry; existing listings are protected rather than removed from an empty result.",
};

export function stockReviewHelp(action: PlanAction): string {
  if (action.kind !== "blocked" && action.kind !== "conflict") return "";
  return guidance[action.reason] ?? "This check could not safely process the vehicle automatically. Compare the saved source details with the dealer website and any linked listing. Resolve the reported issue and run a fresh stock check; approval of eligible items does not bypass this block.";
}

export function stockReviewTitle(action: PlanAction): string {
  const title = [action.displayTitle, action.review?.displayTitle].find(value =>
    value?.trim() && value.trim() !== "Vehicle requiring review");
  if (title) return title.trim();
  if (action.kind === "blocked" && action.reason === "unmapped" && action.section === "missing") {
    return "Previously tracked website record";
  }
  return "Vehicle requiring review";
}
