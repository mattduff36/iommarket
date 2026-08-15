import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  isWaitlistAnonymiseWindowOpen,
  isWaitlistDeleteWindowOpen,
} from "@/lib/retention/report";

describe("waitlist retention calendar cutoff E3A91B-WAIT-001", () => {
  it("opens the delete window after 24 calendar months", () => {
    const closed = new Date(2024, 0, 15);
    expect(isWaitlistDeleteWindowOpen(closed, new Date(2026, 0, 14))).toBe(false);
    expect(isWaitlistDeleteWindowOpen(closed, new Date(2026, 0, 15))).toBe(true);
  });

  it("handles month-end overflow when adding 24 months", () => {
    const closed = new Date(2024, 0, 31);
    const plus24 = addCalendarMonths(closed, 24);
    expect(plus24.getFullYear()).toBe(2026);
    expect(plus24.getMonth()).toBe(0);
    expect(plus24.getDate()).toBe(31);
    expect(isWaitlistDeleteWindowOpen(closed, plus24)).toBe(true);
  });

  it("clamps leap-day plus 24 months to 28 February 2026", () => {
    const closed = new Date(2024, 1, 29);
    const plus24 = addCalendarMonths(closed, 24);
    expect(plus24.getFullYear()).toBe(2026);
    expect(plus24.getMonth()).toBe(1);
    expect(plus24.getDate()).toBe(28);
    expect(isWaitlistDeleteWindowOpen(closed, new Date(2026, 1, 27))).toBe(false);
    expect(isWaitlistDeleteWindowOpen(closed, new Date(2026, 1, 28))).toBe(true);
  });

  it("opens anonymisation after 30 days", () => {
    const closed = new Date(2026, 0, 1);
    expect(isWaitlistAnonymiseWindowOpen(closed, new Date(2026, 0, 30))).toBe(false);
    expect(isWaitlistAnonymiseWindowOpen(closed, new Date(2026, 0, 31))).toBe(true);
  });
});
