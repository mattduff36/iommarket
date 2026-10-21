import {
  addCalendarMonths,
  LAUNCH_PROMOTION_TIMEZONE,
  wallTimeToUtc,
  type WallTime,
} from "@/lib/dealers/onboarding/campaign-window";

/** Prepared internal identity. Recipient addresses never select these terms. */
export const DW_CARS_PREPARED_EMAIL = "dwcars@itrader.im.preview";

export const SKILLANNAYLOR_PREPARED_EMAIL = "skillannaylor@itrader.im.preview";

export type OnboardingOfferKind = "year-end-complimentary" | "calendar-month";

export function resolveOnboardingOfferTerms(preparedIdentityEmail: string): OnboardingOfferKind {
  const value = preparedIdentityEmail.trim().toLowerCase();
  if (value === DW_CARS_PREPARED_EMAIL) return "calendar-month";
  return "year-end-complimentary";
}

/**
 * One Isle of Man calendar month after acceptance.
 * Month-ends clamp (31 January becomes 28 or 29 February). The same instant
 * always yields the same end; it does not stack another month.
 */
export function calendarMonthEndFromAcceptance(acceptedAt: Date): Date {
  const wall = readIsleOfManWall(acceptedAt);
  const shifted = addCalendarMonths(wall, 1);
  const minuteUtc = wallTimeToUtc(shifted, LAUNCH_PROMOTION_TIMEZONE);
  return new Date(minuteUtc.getTime() + wall.second * 1000 + wall.millisecond);
}

function readIsleOfManWall(instant: Date): WallTime & { second: number; millisecond: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LAUNCH_PROMOTION_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const hour = values.hour === "24" ? 0 : Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: instant.getUTCMilliseconds(),
  };
}
