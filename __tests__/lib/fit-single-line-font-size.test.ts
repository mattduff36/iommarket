import { describe, expect, it } from "vitest";
import { fitSingleLineFontSize } from "@/lib/utils/fit-single-line-font-size";

describe("fitSingleLineFontSize", () => {
  it("keeps the base size when the text already fits", () => {
    expect(fitSingleLineFontSize(240, 180, 28, 12)).toBe(28);
  });

  it("shrinks proportionally when the measured text overflows", () => {
    expect(fitSingleLineFontSize(120, 240, 28, 12)).toBe(14);
  });

  it("never shrinks below the minimum size", () => {
    expect(fitSingleLineFontSize(40, 240, 28, 12)).toBe(12);
  });

  it("returns the base size when measurements are not usable", () => {
    expect(fitSingleLineFontSize(0, 180, 28, 12)).toBe(28);
    expect(fitSingleLineFontSize(240, 0, 28, 12)).toBe(28);
    expect(fitSingleLineFontSize(240, 180, 0, 12)).toBe(0);
  });
});
