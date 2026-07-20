/**
 * Listing status transition rules.
 * These define which status transitions are valid and under what conditions.
 */

import type { ListingStatus } from "@prisma/client";
import { formatGbpFromPence } from "@/lib/formatting/gbp";

/**
 * Valid transitions from each status.
 */
const VALID_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["LIVE", "TAKEN_DOWN"],
  APPROVED: ["LIVE", "TAKEN_DOWN"],
  LIVE: ["EXPIRED", "TAKEN_DOWN", "SOLD"],
  EXPIRED: ["DRAFT"], // renewal resets to draft
  TAKEN_DOWN: [], // terminal state for moderation
  SOLD: [], // terminal state – seller has sold the vehicle
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(
  from: ListingStatus,
  to: ListingStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all valid next statuses from a given status.
 */
export function getValidNextStatuses(status: ListingStatus): ListingStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

export const LISTING_DURATION_DAYS = 60;

/**
 * Format price in pence to a display string.
 */
export function formatPricePence(pence: number): string {
  return formatGbpFromPence(pence);
}

/**
 * Calculate listing expiry date (60 days from now).
 */
export function calculateExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + LISTING_DURATION_DAYS * 24 * 60 * 60 * 1000);
}
