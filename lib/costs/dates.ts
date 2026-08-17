export function toUtcDateString(value: Date | string): string {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid date.");
    }
    return parsed.toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function utcDateFromString(value: string): Date {
  const date = new Date(`${toUtcDateString(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid UTC date.");
  }
  return date;
}

export function previousBusinessDay(dateValue: Date | string): string {
  const date = utcDateFromString(toUtcDateString(dateValue));
  const day = date.getUTCDay();
  if (day === 0) date.setUTCDate(date.getUTCDate() - 2);
  if (day === 6) date.setUTCDate(date.getUTCDate() - 1);
  return toUtcDateString(date);
}

export function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function isPeriodClosed(periodEnd: Date, now: Date = new Date()): boolean {
  return periodEnd.getTime() <= startOfUtcMonth(now).getTime();
}

export function isOnOrAfterLaunch(periodStart: Date, startedAt: Date): boolean {
  return periodStart.getTime() >= startedAt.getTime();
}
