import { db } from "@/lib/db";
import { getNumberSetting, getStringSetting, SETTING_KEYS } from "./site-settings";

const DEFAULT_LISTING_FEE_PENCE = 499;
const DEFAULT_FEATURED_FEE_PENCE = 500;
const DEFAULT_FREE_WINDOW_DAYS = 30;

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Sync version (env only) — kept for backwards compatibility and tests */
export function getListingFeePence(): number {
  return parseIntegerEnv(process.env.LISTING_FEE_PENCE, DEFAULT_LISTING_FEE_PENCE);
}

export function getPrivateListingStripePriceId(): string {
  const priceId = process.env.STRIPE_PRIVATE_LISTING_FEE;
  if (!priceId) {
    throw new Error("STRIPE_PRIVATE_LISTING_FEE is not set");
  }
  return priceId;
}

/** Sync version (env only) */
export function getFeaturedFeePence(): number {
  return parseIntegerEnv(process.env.FEATURED_FEE_PENCE, DEFAULT_FEATURED_FEE_PENCE);
}

export function getLaunchFreeUntil(): Date | null {
  const raw = process.env.LAUNCH_FREE_UNTIL;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getFreeListingWindowDays(): number {
  return parseIntegerEnv(process.env.FREE_LISTING_WINDOW_DAYS, DEFAULT_FREE_WINDOW_DAYS);
}

export function isListingFreeNow(now = new Date()): boolean {
  const freeUntil = getLaunchFreeUntil();
  if (freeUntil) return now <= freeUntil;
  return false;
}

// ---------------------------------------------------------------------------
// Async DB-backed variants (check DB first, fall back to env)
// ---------------------------------------------------------------------------

export async function getListingFeePenceAsync(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.LISTING_FEE_PENCE, getListingFeePence());
}

export async function getFeaturedFeePenceAsync(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.FEATURED_FEE_PENCE, getFeaturedFeePence());
}

export async function getFreeListingWindowDaysAsync(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.FREE_LISTING_WINDOW_DAYS, getFreeListingWindowDays());
}

export async function getLaunchFreeUntilAsync(): Promise<Date | null> {
  const raw = await getStringSetting(SETTING_KEYS.LAUNCH_FREE_UNTIL, "");
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return getLaunchFreeUntil();
}

export async function isListingFreeNowAsync(now = new Date()): Promise<boolean> {
  const freeUntil = await getLaunchFreeUntilAsync();
  if (freeUntil) return now <= freeUntil;
  return false;
}

// ---------------------------------------------------------------------------
// Free launch slots (first N private sellers get free listing)
// ---------------------------------------------------------------------------

const DEFAULT_FREE_LAUNCH_SLOTS = 100;

/** Total number of free launch slots (configurable via SiteSetting) */
export async function getFreeLaunchSlotsTotal(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.FREE_LAUNCH_SLOTS_TOTAL, DEFAULT_FREE_LAUNCH_SLOTS);
}

/**
 * Count of unique users who have claimed a free private seller listing.
 * A "free" listing = private seller (dealerId null), approved through moderation
 * (APPROVED / LIVE / SOLD / EXPIRED), and has no successful Payment.
 * PENDING and DRAFT listings don't count — the slot is only consumed once
 * an admin has approved the listing.
 */
export async function getFreeLaunchSlotsUsed(): Promise<number> {
  const paidListingIds = await db.payment
    .findMany({
      where: { status: "SUCCEEDED", type: "LISTING" },
      select: { listingId: true },
    })
    .then((rows) => new Set(rows.map((r) => r.listingId)));

  const listings = await db.listing.findMany({
    where: {
      dealerId: null,
      status: { in: ["APPROVED", "LIVE", "SOLD", "EXPIRED"] },
    },
    select: { userId: true, id: true },
  });

  const usersWithFreeListing = new Set<string>();
  for (const l of listings) {
    if (!paidListingIds.has(l.id)) {
      usersWithFreeListing.add(l.userId);
    }
  }
  return usersWithFreeListing.size;
}

/** Number of free slots remaining (0 when all claimed) */
export async function getFreeLaunchSlotsRemaining(): Promise<number> {
  const [total, used] = await Promise.all([
    getFreeLaunchSlotsTotal(),
    getFreeLaunchSlotsUsed(),
  ]);
  return Math.max(0, total - used);
}

/**
 * True if the user has already claimed a free slot — meaning they have a free
 * private seller listing that is at least submitted (PENDING or later).
 * We check all non-DRAFT statuses here so the user can't submit multiple free
 * listings while one is awaiting moderation.
 */
export async function hasUserClaimedFreeSlot(userId: string): Promise<boolean> {
  const paidListingIds = await db.payment
    .findMany({
      where: { status: "SUCCEEDED", type: "LISTING" },
      select: { listingId: true },
    })
    .then((rows) => new Set(rows.map((r) => r.listingId)));

  const userListings = await db.listing.findMany({
    where: {
      userId,
      dealerId: null,
      status: { not: "DRAFT" },
    },
    select: { id: true },
  });

  return userListings.some((l) => !paidListingIds.has(l.id));
}

/**
 * True if a private seller listing can be free: slots remaining and user hasn't claimed yet.
 * Also true if time-based free window (LAUNCH_FREE_UNTIL) is active (backwards compat).
 */
export async function isPrivateListingFreeForUser(userId: string): Promise<boolean> {
  const freeUntil = await getLaunchFreeUntilAsync();
  if (freeUntil && new Date() <= freeUntil) return true;

  const [remaining, hasClaimed] = await Promise.all([
    getFreeLaunchSlotsRemaining(),
    hasUserClaimedFreeSlot(userId),
  ]);
  return remaining > 0 && !hasClaimed;
}
