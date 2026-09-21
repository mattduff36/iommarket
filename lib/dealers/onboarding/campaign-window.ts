export const LAUNCH_PROMOTION_KEY = "launch-pro";
export const LAUNCH_PROMOTION_TIMEZONE = "Europe/Isle_of_Man";
export const LAUNCH_PROMOTION_MONTHS = 3;

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export class InvalidLaunchDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLaunchDateError";
  }
}

export function parseLaunchLocalDateTime(value: string): WallTime {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) {
    throw new InvalidLaunchDateError(
      "Enter the Isle of Man launch date and time as YYYY-MM-DDTHH:mm.",
    );
  }
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (
    wall.month < 1 ||
    wall.month > 12 ||
    wall.hour > 23 ||
    wall.minute > 59 ||
    wall.day < 1 ||
    wall.day > daysInMonth(wall.year, wall.month)
  ) {
    throw new InvalidLaunchDateError("That launch date is not a real calendar date.");
  }
  return wall;
}

export function addCalendarMonths(wall: WallTime, months: number): WallTime {
  const monthIndex = wall.month - 1 + months;
  const year = wall.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(wall.day, daysInMonth(year, month + 1));
  return {
    year,
    month: month + 1,
    day,
    hour: wall.hour,
    minute: wall.minute,
  };
}

export function wallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const firstOffset = timeZoneOffsetMs(new Date(guess), timeZone);
  const adjusted = new Date(guess - firstOffset);
  const secondOffset = timeZoneOffsetMs(adjusted, timeZone);
  const utc = new Date(guess - secondOffset);
  if (!sameWallTime(utc, wall, timeZone)) {
    throw new InvalidLaunchDateError(
      "That local time does not exist in the Isle of Man. Choose a time outside the clock change.",
    );
  }
  return utc;
}

export function buildLaunchCampaignWindow(localDateTime: string) {
  const startsWall = parseLaunchLocalDateTime(localDateTime);
  const endsWall = addCalendarMonths(startsWall, LAUNCH_PROMOTION_MONTHS);
  const startsAt = wallTimeToUtc(startsWall, LAUNCH_PROMOTION_TIMEZONE);
  const endsAt = wallTimeToUtc(endsWall, LAUNCH_PROMOTION_TIMEZONE);
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new InvalidLaunchDateError("The promotion end must be after the launch time.");
  }
  return {
    key: LAUNCH_PROMOTION_KEY,
    timezone: LAUNCH_PROMOTION_TIMEZONE,
    startsAt,
    endsAt,
  };
}

export function formatIsleOfManDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LAUNCH_PROMOTION_TIMEZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(value);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const hour = values.hour === "24" ? 0 : Number(values.hour);
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function sameWallTime(date: Date, wall: WallTime, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const hour = values.hour === "24" ? 0 : Number(values.hour);
  return (
    Number(values.year) === wall.year &&
    Number(values.month) === wall.month &&
    Number(values.day) === wall.day &&
    hour === wall.hour &&
    Number(values.minute) === wall.minute
  );
}
