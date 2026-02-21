const DEFAULT_LISTING_FEE_PENCE = 499;
const DEFAULT_FEATURED_FEE_PENCE = 499;
const DEFAULT_FREE_WINDOW_DAYS = 30;

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getListingFeePence(): number {
  return parseIntegerEnv(process.env.LISTING_FEE_PENCE, DEFAULT_LISTING_FEE_PENCE);
}

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
