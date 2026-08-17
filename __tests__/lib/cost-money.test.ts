import { describe, expect, it } from "vitest";
import {
  computeMarkedGbpMinor,
  parseDecimalString,
  roundHalfAwayFromZero,
} from "@/lib/costs/money";

describe("COST-FX-001 marked GBP conversion", () => {
  it("applies the hidden uplift and half-away-from-zero penny rounding", () => {
    expect(computeMarkedGbpMinor("10", "1")).toBe(1200n);
    expect(computeMarkedGbpMinor("10.00", "0.75")).toBe(900n);
    expect(computeMarkedGbpMinor("1", "0.83333333")).toBe(100n);
    expect(computeMarkedGbpMinor("0.004", "1")).toBe(0n);
    expect(computeMarkedGbpMinor("0.005", "1")).toBe(1n);
    expect(computeMarkedGbpMinor("-1.25", "0.8")).toBe(-120n);
    expect(roundHalfAwayFromZero(15n, 10n)).toBe(2n);
    expect(roundHalfAwayFromZero(-15n, 10n)).toBe(-2n);
    expect(parseDecimalString("-12.50")).toEqual({ unscaled: -1250n, scale: 2 });
  });
});
