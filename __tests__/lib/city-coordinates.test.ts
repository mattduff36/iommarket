import { describe, expect, it } from "vitest";
import { cityCoordinate } from "@/lib/analytics/city-coordinates";

describe("city coordinate lookup", () => {
  it("places London in the United Kingdom and London in Canada at different points", () => {
    const britain = cityCoordinate("London", "United Kingdom");
    const canada = cityCoordinate("London", "Canada");
    expect(britain?.latitude).toBeGreaterThan(51);
    expect(britain?.longitude).toBeGreaterThan(-1);
    expect(britain?.longitude).toBeLessThan(1);
    expect(canada?.latitude).toBeGreaterThan(42);
    expect(canada?.latitude).toBeLessThan(44);
    expect(canada?.longitude).toBeLessThan(-80);
  });

  it("matches English exonyms and accent-insensitive country names", () => {
    const cologne = cityCoordinate("Cologne", "Germany");
    expect(cologne?.latitude).toBeGreaterThan(50);
    expect(cologne?.longitude).toBeGreaterThan(6);
    expect(cityCoordinate("Douglas", "Isle of Man")?.latitude).toBeGreaterThan(54);
  });

  it("returns null when the city or country is unknown", () => {
    expect(cityCoordinate("Not A Real City", "United Kingdom")).toBeNull();
    expect(cityCoordinate("London", "Not A Real Country")).toBeNull();
    expect(cityCoordinate("", "United Kingdom")).toBeNull();
  });
});
