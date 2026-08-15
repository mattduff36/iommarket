import type { ListingModerationReason } from "@prisma/client";

export const LISTING_MODERATION_REASONS = [
  "FRAUD",
  "PROHIBITED",
  "MISLEADING",
  "DUPLICATE",
  "POLICY",
  "SAFETY",
  "ACCOUNT_DISABLED",
  "OTHER",
] as const satisfies readonly ListingModerationReason[];

export const LISTING_MODERATION_REASON_LABELS: Record<
  ListingModerationReason,
  string
> = {
  FRAUD: "Fraud or scam",
  PROHIBITED: "Prohibited item",
  MISLEADING: "Misleading or inaccurate",
  DUPLICATE: "Duplicate listing",
  POLICY: "Policy violation",
  SAFETY: "Safety concern",
  ACCOUNT_DISABLED: "Account disabled",
  OTHER: "Other",
};

export const REASONS_REQUIRING_NOTES: ReadonlySet<ListingModerationReason> =
  new Set(["OTHER"]);

export function requiresModerationNotes(reason: ListingModerationReason) {
  return REASONS_REQUIRING_NOTES.has(reason);
}

export function validateModerationReason(input: {
  reasonCode?: ListingModerationReason;
  notes?: string | null;
  required: boolean;
}) {
  if (!input.required) return null;
  if (!input.reasonCode) return "A reason is required.";
  if (requiresModerationNotes(input.reasonCode) && !input.notes?.trim()) {
    return "Notes are required when the reason is Other.";
  }
  return null;
}
