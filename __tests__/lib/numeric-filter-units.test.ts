import { describe, expect, it } from "vitest";
import {
  chargingTimeHoursToSliderMinutes,
  chargingTimeSliderMinutesToHours,
  engineSizeLitresToSlider,
  engineSizeSliderToLitres,
  normalizeNumericFilterUnits,
} from "@/lib/search/numeric-filter-units";

describe("numeric filter URL units", () => {
  it("converts legacy whole-number tenths and minutes but preserves decimal canonical values", () => {
    expect(normalizeNumericFilterUnits({ minEngineSize: "16", maxChargingTime: "100" })).toMatchObject({
      minEngineSize: "1.6",
      maxChargingTime: "1.666667",
      numericFilterUnits: "v1",
    });
    expect(normalizeNumericFilterUnits({ minEngineSize: "1.6", minChargingTime: "0.166667" })).toMatchObject({
      minEngineSize: "1.6",
      minChargingTime: "0.166667",
      numericFilterUnits: "v1",
    });
  });

  it("keeps v1 integer liters and hours canonical", () => {
    expect(normalizeNumericFilterUnits({
      minEngineSize: "1",
      minChargingTime: "4",
      numericFilterUnits: "v1",
    })).toMatchObject({
      minEngineSize: "1",
      minChargingTime: "4",
      numericFilterUnits: "v1",
    });
  });

  it("rounds slider conversions to stable units", () => {
    expect(engineSizeLitresToSlider(1.6)).toBe(16);
    expect(engineSizeSliderToLitres(16)).toBe(1.6);
    expect(chargingTimeHoursToSliderMinutes(1.666667)).toBe(100);
    expect(chargingTimeSliderMinutesToHours(100)).toBe(1.666667);
    expect(chargingTimeSliderMinutesToHours(10)).toBe(0.166667);
  });
});
