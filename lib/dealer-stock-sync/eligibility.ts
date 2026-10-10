import type { DealerSyncSubject } from "./types";

export function dealerSyncBlockReason(dealer: DealerSyncSubject) {
  if (dealer.isAdminPreview) return "admin-preview";
  if (dealer.role !== "DEALER") return "not-live-dealer";
  if (dealer.disabledAt) return "disabled";
  if (dealer.deletedAt) return "deleted";
  return null;
}

export function isEligibleDealer(dealer: DealerSyncSubject) {
  return dealerSyncBlockReason(dealer) == null;
}
