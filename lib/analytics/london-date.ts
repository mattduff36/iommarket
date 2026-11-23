export function londonDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** UTC instant of midnight in London, including the GMT/BST boundary. */
export function londonMidnight(isoDate: string): Date {
  const midnight = new Date(`${isoDate}T00:00:00.000Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23",
  }).format(midnight));
  return new Date(midnight.getTime() - hour * 60 * 60 * 1000);
}

export function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function eachIsoDate(startDate: string, endDate: string): string[] {
  const count = inclusiveDaySpan(startDate, endDate);
  return Array.from({ length: count }, (_, index) => shiftIsoDate(startDate, index));
}
