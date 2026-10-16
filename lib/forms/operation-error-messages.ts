/** Exact local domain refusals; arbitrary Error.message values are never trusted. */
const KNOWN: Record<string, readonly string[]> = {
  updateReportStatus: ["Report not found"],
  createDealerProfile: [
    "User not found", "User already has a dealer profile",
    "Private users must receive a dealer upgrade offer and accept the dealer documents before activation.",
  ],
  verifyDealer: ["Dealer not found"],
  adminDeleteImage: ["Image not found", "Take the listing down before deleting images from a live or sold listing."],
  restoreUser: ["This account has a processing or completed deletion job and cannot be restored."],
  saveChecklist: ["The checklist changed in another session. Refresh and try again.", "The stored checklist is malformed. No entries were loaded or saved."],
  updateChecklistCompletion: ["The checklist changed in another session. Refresh and try again.", "The stored checklist is malformed. No entries were loaded or saved."],
};

export function knownOperationMessage(error: unknown, action: string): string | null {
  if (!(error instanceof Error)) return null;
  return KNOWN[action]?.find((message) => message === error.message) ?? null;
}
