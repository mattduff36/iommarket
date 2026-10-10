const LONDON = "Europe/London";

export interface LondonClock {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
}

export function londonClock(date: Date): LondonClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
  };
}

export function isFridaySixLondon(date: Date) {
  const clock = londonClock(date);
  return clock.weekday === "Fri" && clock.hour === 6;
}

/** ISO week of the Europe/London calendar date. */
export function londonWeekKey(date: Date) {
  const clock = londonClock(date);
  const utc = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
