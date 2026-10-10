import type { PlanAction } from "./types";

export interface ReviewSections {
  created: PlanAction[];
  changed: PlanAction[];
  missingOnce: PlanAction[];
  unpublish: PlanAction[];
  blocked: PlanAction[];
  conflicts: PlanAction[];
  unchanged: number;
}

export function reviewSections(actions: PlanAction[]): ReviewSections {
  return {
    created: actions.filter((action) => action.kind === "create" || (action.kind === "blocked" && action.section === "new")),
    changed: actions.filter((action) => action.kind === "update"),
    missingOnce: actions.filter((action) => action.kind === "missing_once"),
    unpublish: actions.filter((action) => action.kind === "unpublish"),
    blocked: actions.filter((action) => action.kind === "blocked" && action.section !== "new"),
    conflicts: actions.filter((action) => action.kind === "conflict"),
    unchanged: actions.filter((action) => action.kind === "unchanged").length,
  };
}

export function actionLabel(action: PlanAction) {
  if (action.kind === "create") return "New listing";
  if (action.kind === "update") return "Changed";
  if (action.kind === "missing_once") return "Missing once";
  if (action.kind === "unpublish") return "Proposed unpublish";
  if (action.kind === "conflict") return "Conflict";
  if (action.kind === "unchanged") return "Unchanged";
  return "Blocked";
}

const reasons: Record<string, string> = {
  "identity-uncertain": "Some website vehicle references were missing or conflicting. Existing listings are protected.",
  "source-failed": "One or more website sections could not be checked.",
  "pagination-uncertain": "The website did not confirm that every stock page was checked.",
  "detail-uncertain": "Some vehicle details could not be checked.",
  "partial-inventory": "Fewer vehicles were returned than the website advertises.",
  "zero-inventory": "No stock was returned. Existing listings are protected.",
  "absent-baseline": "First check recorded the current listing values. Run another check to compare changes.",
  "dealer-edited": "The listing was edited after its last import. Review it manually.",
  "unmapped-existing-stock": "Existing listings need to be matched to their website records before adding stock.",
  "images-not-owned": "No usable source photos were found.",
  "missing-region": "The dealer needs a location before stock can be added.",
  "paid-feature": "This featured listing is protected from automatic removal.",
  "sold-preserved": "The listing is already marked sold.",
  "manual-taken-down": "The listing was previously taken down.",
  "pending-revision": "The listing has edits awaiting review.",
  "source-sold": "The website marks this vehicle as sold. Review it manually.",
  "duplicate-source": "The website returned conflicting records for this vehicle.",
  "duplicate-managed-listing": "More than one listing matches this vehicle.",
  "unstable-identity": "The website does not provide a reliable vehicle reference.",
  "status-preserved": "The listing is not currently live.",
  "unmapped": "The website record has not been matched to a listing.",
};
export function stockSyncReason(reason: string) { return reasons[reason] ?? reason.replaceAll("-", " "); }
export function stockSyncStatus(status: string) { return status.toLowerCase().replaceAll("_", " "); }
