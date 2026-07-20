import { describe, expect, it } from "vitest";
import {
  LOGARITHMIC_POSITION_MAX,
  logarithmicPositionToValue,
  valueToLogarithmicPosition,
} from "@/lib/utils/range-scale";

const PRICE_MIN = 1_000;
const PRICE_MAX = 250_000;
const PRICE_STEP = 500;

describe("logarithmic range scale", () => {
  it("maps exact endpoints in both directions", () => {
    expect(valueToLogarithmicPosition(PRICE_MIN, PRICE_MIN, PRICE_MAX)).toBe(0);
    expect(valueToLogarithmicPosition(PRICE_MAX, PRICE_MIN, PRICE_MAX)).toBe(
      LOGARITHMIC_POSITION_MAX,
    );
    expect(
      logarithmicPositionToValue(0, PRICE_MIN, PRICE_MAX, PRICE_STEP),
    ).toBe(PRICE_MIN);
    expect(
      logarithmicPositionToValue(
        LOGARITHMIC_POSITION_MAX,
        PRICE_MIN,
        PRICE_MAX,
        PRICE_STEP,
      ),
    ).toBe(PRICE_MAX);
  });

  it("increases actual values faster toward the upper end", () => {
    const lowQuarter = logarithmicPositionToValue(
      250,
      PRICE_MIN,
      PRICE_MAX,
      PRICE_STEP,
    );
    const highQuarterStart = logarithmicPositionToValue(
      750,
      PRICE_MIN,
      PRICE_MAX,
      PRICE_STEP,
    );

    expect(lowQuarter - PRICE_MIN).toBeLessThan(
      PRICE_MAX - highQuarterStart,
    );
  });

  it("rounds emitted prices to usable increments", () => {
    const midpointValue = logarithmicPositionToValue(
      500,
      PRICE_MIN,
      PRICE_MAX,
      PRICE_STEP,
    );

    expect(midpointValue).toBe(16_000);
    expect(midpointValue % PRICE_STEP).toBe(0);
  });

  it("rejects non-positive logarithmic boundaries", () => {
    expect(() => valueToLogarithmicPosition(10, 0, 100)).toThrow(RangeError);
  });
});
