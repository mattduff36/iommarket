import { getNumberSetting, getStringSetting, SETTING_KEYS } from "./site-settings";

const DEFAULT_LISTING_FEE_PENCE = 499;
const DEFAULT_FEATURED_FEE_PENCE = 499;
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
