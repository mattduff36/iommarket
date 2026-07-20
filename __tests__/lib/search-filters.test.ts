import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FUEL_CONSUMPTION_MAX,
  MILEAGE_MAX,
  PRICE_MAX,
  PRICE_MIN,
  TAX_MAX,
  YEAR_MIN,
  getCurrentYear,
  parseBoundedRange,
  parseOptionalBoundedInteger,
  parseYearRange,
} from "@/lib/constants/search-filters";

describe("vehicle search filter ranges", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the requested numeric boundaries", () => {
    expect(PRICE_MIN).toBe(1_000);
    expect(PRICE_MAX).toBe(250_000);
    expect(MILEAGE_MAX).toBe(200_000);
    expect(FUEL_CONSUMPTION_MAX).toBe(150);
    expect(TAX_MAX).toBe(750);
  });

  it("keeps the year minimum fixed and derives the maximum at runtime", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));

    expect(YEAR_MIN).toBe(1920);
    expect(getCurrentYear()).toBe(2031);
    expect(parseYearRange(undefined, undefined)).toEqual([1920, 2031]);
  });

  it("clamps URL-derived years to the supported range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-06-01T00:00:00.000Z"));

    expect(parseYearRange("1800", "2100")).toEqual([1920, 2031]);
    expect(parseYearRange("2020", "2010")).toEqual([1920, 2031]);
  });

  it("bounds numeric URL values and rejects invalid integers", () => {
    expect(parseBoundedRange("-100", "999999", 0, 200_000)).toEqual([
      0,
      200_000,
    ]);
    expect(parseOptionalBoundedInteger("invalid", 0, 750)).toBeUndefined();
    expect(parseOptionalBoundedInteger("100abc", 0, 750)).toBeUndefined();
    expect(parseOptionalBoundedInteger("900", 0, 750)).toBe(750);
  });
});
