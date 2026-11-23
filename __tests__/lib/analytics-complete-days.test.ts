import { describe, expect, it } from "vitest";
import { analyticsRange } from "@/lib/analytics/business-funnel";
import { londonMidnight } from "@/lib/analytics/london-date";

describe("complete London analytics days", () => {
  it("excludes the whole current London day and compares equal calendar periods", () => {
    const range = analyticsRange("7d", new Date("2026-07-04T23:30:00Z"));
    expect(range).toMatchObject({ startDate: "2026-06-28", endDate: "2026-07-04", days: 7 });
    expect(range.until.toISOString()).toBe("2026-07-04T23:00:00.000Z");
    expect(range.since.toISOString()).toBe("2026-06-27T23:00:00.000Z");
    expect(range.previousSince.toISOString()).toBe("2026-06-20T23:00:00.000Z");
  });
  it("handles both daylight-saving transitions without adding a partial day", () => {
    expect(londonMidnight("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(londonMidnight("2026-03-30").toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(londonMidnight("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(londonMidnight("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    const range = analyticsRange("7d", new Date("2026-03-30T12:00:00Z"));
    expect((range.until.getTime() - range.since.getTime()) / 3600000).toBe(167);
  });
});
