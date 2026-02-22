/**
 * Listing status transition rules.
 * These define which status transitions are valid and under what conditions.
 */

import type { ListingStatus } from "@prisma/client";

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

/**
 * Listing fee constants in pence.
 */
export const LISTING_FEES = {
  STANDARD_LISTING: 499, // £4.99
  FEATURED_UPGRADE: 499, // £4.99
  DEALER_MONTHLY: 2999, // £29.99/month
} as const;

/**
 * Calculate the total fee for a listing with optional featured upgrade.
 */
export function calculateListingFee(options: {
  featured?: boolean;
}): number {
  let total = LISTING_FEES.STANDARD_LISTING;
  if (options.featured) {
    total += LISTING_FEES.FEATURED_UPGRADE;
  }
  return total;
}

/**
 * Format price in pence to a display string.
 */
export function formatPricePence(pence: number): string {
  const pounds = pence / 100;
  return Number.isInteger(pounds)
    ? `£${pounds.toLocaleString()}`
    : `£${pounds.toFixed(2)}`;
}

/**
 * Calculate listing expiry date (30 days from now).
 */
export function calculateExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
}
