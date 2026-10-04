import { describe, expect, it } from "vitest";
import { calendarDay, percentDelta, trendSeries } from "@/lib/analytics/trend-series";

describe("analytics trend series", () => {
  it("fills missing days and keeps supplied visitor and listing counts", () => {
    expect(trendSeries({
      startDate: "2026-03-28",
      endDate: "2026-03-30",
      visitors: [{ date: "2026-03-29", users: 4, pageviews: 9 }],
      listingViews: [{ date: "2026-03-28", count: 2 }],
    })).toEqual([
      { date: "2026-03-28", label: "28 Mar", users: 0, pageviews: 0, listingViews: 2 },
      { date: "2026-03-29", label: "29 Mar", users: 4, pageviews: 9, listingViews: 0 },
      { date: "2026-03-30", label: "30 Mar", users: 0, pageviews: 0, listingViews: 0 },
    ]);
  });

  it("reads calendar days from date values and hides a delta when the previous period is empty", () => {
    expect(calendarDay(new Date(2026, 2, 28))).toBe("2026-03-28");
    expect(calendarDay("2026-03-28T00:00:00.000Z")).toBe("2026-03-28");
    expect(percentDelta(10, 0)).toBeNull();
    expect(percentDelta(15, 10)).toBe(50);
    expect(percentDelta(5, 10)).toBe(-50);
  });
});
