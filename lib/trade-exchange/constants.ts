export const TRADE_LIVE_CAP = 50;
export const TRADE_DEFAULT_EXPIRY_DAYS = 30;
export const TRADE_PHOTO_LIMIT = 12;
export const TRADE_IMPORT_ROW_LIMIT = 30;
export const TRADE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const TRADE_MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const TRADE_STALE_WINDOW_DAYS = 7;

export const TRADE_TRANSMISSIONS = ["Manual", "Automatic", "Semi-automatic", "Other"] as const;
export const TRADE_FUELS = ["Petrol", "Diesel", "Hybrid", "Electric", "Other"] as const;
export const TRADE_REASON_CODES = [
  "ELIGIBILITY",
  "EVIDENCE",
  "AUTHORITY",
  "DUPLICATE",
  "POLICY",
  "OTHER",
] as const;
export const TRADE_REPORT_REASONS = [
  "MISLEADING",
  "WRITTEN_OFF",
  "NOT_AVAILABLE",
  "ABUSE",
  "OTHER",
] as const;

export const TRADE_CAP_STATUSES = ["LIVE", "RESERVED"] as const;

export function tradeExpiryDays(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TRADE_LISTING_EXPIRY_DAYS ?? TRADE_DEFAULT_EXPIRY_DAYS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) return TRADE_DEFAULT_EXPIRY_DAYS;
  return parsed;
}

export function tradeExpiryDate(from = new Date(), env: NodeJS.ProcessEnv = process.env): Date {
  return new Date(from.getTime() + tradeExpiryDays(env) * 86_400_000);
}
