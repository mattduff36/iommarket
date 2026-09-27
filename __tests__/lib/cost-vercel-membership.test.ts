import { describe, expect, it } from "vitest";
import {
  VERCEL_MEMBERSHIP_DAILY_GBP,
  VERCEL_MEMBERSHIP_LABEL,
  vercelMembershipDailyMinor,
  vercelMembershipDays,
} from "@/lib/costs/vercel-membership";

describe("Vercel Pro membership share", () => {
  it("adds £0.38 for each UTC day from the ledger start through today", () => {
    const days = vercelMembershipDays(
      new Date("2026-08-13T23:00:00.000Z"),
      new Date("2026-08-15T12:00:00.000Z"),
    );

    expect(days.map((day) => day.day)).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    expect(days[0]?.periodStart.toISOString()).toBe("2026-08-13T23:00:00.000Z");
    expect(days[1]?.periodStart.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(days.every((day) => day.nativeAmount === VERCEL_MEMBERSHIP_DAILY_GBP)).toBe(true);
    expect(days.every((day) => day.displayLabel === VERCEL_MEMBERSHIP_LABEL)).toBe(true);
    expect(days.every((day) => day.bucketKey.startsWith("vercel:membership:"))).toBe(true);
    expect(vercelMembershipDailyMinor()).toBe(38n);
  });
});
