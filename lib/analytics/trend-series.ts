import { eachIsoDate } from "@/lib/analytics/london-date";

export interface TrendPoint {
  date: string;
  label: string;
  users: number;
  pageviews: number;
  listingViews: number;
}

export function calendarDay(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  if (typeof value === "string") return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? "";
  return "";
}

export function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function trendSeries(input: {
  startDate: string;
  endDate: string;
  visitors: Array<{ date: string; users: number; pageviews: number }>;
  listingViews: Array<{ date: string; count: number }>;
}): TrendPoint[] {
  const visitors = new Map(input.visitors.map((point) => [point.date, point]));
  const listingViews = new Map(input.listingViews.map((point) => [point.date, point.count]));
  return eachIsoDate(input.startDate, input.endDate).map((date) => {
    const visitor = visitors.get(date);
    return {
      date,
      label: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      users: visitor?.users ?? 0,
      pageviews: visitor?.pageviews ?? 0,
      listingViews: listingViews.get(date) ?? 0,
    };
  });
}
