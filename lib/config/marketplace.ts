import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getNumberSetting, getStringSetting, SETTING_KEYS } from "./site-settings";
import { getMarketplacePricing } from "./marketplace-pricing";

const DEFAULT_FREE_WINDOW_DAYS = 30;

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getPrivateListingPaymentLinkUrl(): string {
  const url = process.env.RIPPLE_LISTING_PAYMENT_URL?.trim();
  if (!url) {
    throw new Error("RIPPLE_LISTING_PAYMENT_URL is not set");
  }
  return url;
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
// Async DB-backed pricing
// ---------------------------------------------------------------------------

export async function getListingFeePenceAsync(): Promise<number> {
  const pricing = await getMarketplacePricing();
  return pricing.privateListingPence;
}

export async function getFeaturedFeePenceAsync(): Promise<number> {
  const pricing = await getMarketplacePricing();
  return pricing.featuredUpgradePence;
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

const DEFAULT_FREE_LAUNCH_SLOTS = 200;

/** Total number of free launch slots (configurable via SiteSetting) */
export async function getFreeLaunchSlotsTotal(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.FREE_LAUNCH_SLOTS_TOTAL, DEFAULT_FREE_LAUNCH_SLOTS);
}

/** Count of durable claims for the free private-listing launch offer. */
export async function getFreeLaunchSlotsUsed(): Promise<number> {
  return db.freeListingClaim.count();
}

/** Number of free slots remaining (0 when all claimed) */
export async function getFreeLaunchSlotsRemaining(): Promise<number> {
  const [total, used] = await Promise.all([
    getFreeLaunchSlotsTotal(),
    getFreeLaunchSlotsUsed(),
  ]);
  return Math.max(0, total - used);
}

export async function hasUserClaimedFreeSlot(userId: string): Promise<boolean> {
  const claim = await db.freeListingClaim.findUnique({
    where: { userId },
    select: { id: true },
  });
  return Boolean(claim);
}

export interface FreeListingEligibility {
  canClaim: boolean;
  slotsRemaining: number;
}

export function isFreeListingEligible({
  hasClaimed,
  slotsRemaining,
}: {
  hasClaimed: boolean;
  slotsRemaining: number;
}): boolean {
  return !hasClaimed && slotsRemaining > 0;
}

export async function getFreeListingEligibility(
  userId: string
): Promise<FreeListingEligibility> {
  const [hasClaimed, slotsRemaining] = await Promise.all([
    hasUserClaimedFreeSlot(userId),
    getFreeLaunchSlotsRemaining(),
  ]);

  return {
    canClaim: isFreeListingEligible({ hasClaimed, slotsRemaining }),
    slotsRemaining,
  };
}

/**
 * Read-only eligibility snapshot for UI and payment routing. Submitting a
 * listing must use claimFreeListingSlot so the database remains authoritative.
 */
export async function isPrivateListingFreeForUser(userId: string): Promise<boolean> {
  const eligibility = await getFreeListingEligibility(userId);
  return eligibility.canClaim;
}

type FreeListingClaimResult<T> =
  | { status: "claimed"; data: T }
  | { status: "already-claimed" }
  | { status: "slots-exhausted" };

interface ClaimFreeListingSlotInput<T> {
  userId: string;
  listingId: string;
  onClaim: (transaction: Prisma.TransactionClient) => Promise<T>;
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

/**
 * Atomically reserves one launch slot and executes the related listing update.
 * The callback is in the same serializable transaction, so a failed submission
 * cannot consume a slot and concurrent claims cannot oversubscribe the offer.
 */
export async function claimFreeListingSlot<T>({
  userId,
  listingId,
  onClaim,
}: ClaimFreeListingSlotInput<T>): Promise<FreeListingClaimResult<T>> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const slotsTotal = await getFreeLaunchSlotsTotal();
    try {
      return await db.$transaction(
        async (transaction) => {
          const existingClaim = await transaction.freeListingClaim.findUnique({
            where: { userId },
            select: { id: true },
          });
          if (existingClaim) return { status: "already-claimed" };

          const slotsUsed = await transaction.freeListingClaim.count();
          const slotsRemaining = Math.max(0, slotsTotal - slotsUsed);
          if (!isFreeListingEligible({ hasClaimed: false, slotsRemaining })) {
            return { status: "slots-exhausted" };
          }

          const data = await onClaim(transaction);
          await transaction.freeListingClaim.create({
            data: { userId, listingId },
          });

          return { status: "claimed", data };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === maxAttempts) throw error;
    }
  }

  throw new Error("Failed to reserve a free listing slot.");
}
