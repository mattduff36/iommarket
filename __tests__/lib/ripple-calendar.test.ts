import { describe, expect, it } from "vitest";
import { addClampedCalendarMonth } from "@/lib/payments/ripple-calendar";

describe("RIP-CALENDAR-001 clamped calendar months", () => {
  it("clamps month-end and leap-day boundaries", () => {
    expect(addClampedCalendarMonth(new Date("2026-01-31T12:00:00.000Z"))).toEqual(
      new Date("2026-02-28T12:00:00.000Z")
    );
    expect(addClampedCalendarMonth(new Date("2024-01-31T12:00:00.000Z"))).toEqual(
      new Date("2024-02-29T12:00:00.000Z")
    );
    expect(addClampedCalendarMonth(new Date("2024-02-29T09:00:00.000Z"))).toEqual(
      new Date("2024-03-29T09:00:00.000Z")
    );
    expect(addClampedCalendarMonth(new Date("2026-08-31T00:00:00.000Z"))).toEqual(
      new Date("2026-09-30T00:00:00.000Z")
    );
  });
});
