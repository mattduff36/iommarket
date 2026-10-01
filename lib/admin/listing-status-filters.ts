/** Shared filter values: safe to import from either server or browser code. */
export const ADMIN_LISTING_STATUS_FILTERS = [
  "ALL",
  "PENDING",
  "PENDING_EDITS",
  "LIVE",
  "TAKEN_DOWN",
  "REJECTED",
  "DRAFT",
  "EXPIRED",
  "SOLD",
] as const;

export type AdminListingStatusFilter = (typeof ADMIN_LISTING_STATUS_FILTERS)[number];
