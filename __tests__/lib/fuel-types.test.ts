import { describe, expect, it } from "vitest";
import {
  FUEL_TYPE_OPTIONS,
  getFuelTypeFilterValues,
  LEGACY_FUEL_TYPE_FILTER_VALUE,
  parseFuelTypeFilter,
} from "@/lib/constants/fuel-types";

describe("fuel types", () => {
  it("defines the seven supported values in display order", () => {
    expect(FUEL_TYPE_OPTIONS).toEqual([
      "Petrol",
      "Diesel",
      "Electric",
      "Petrol Hybrid",
      "Diesel Hybrid",
      "Petrol Plug-in Hybrid",
      "Diesel Plug-in Hybrid",
    ]);
  });

  it("filters a long plug-in value by an exact stored value", () => {
    const filter = parseFuelTypeFilter("Diesel Plug-in Hybrid");

    expect(filter).toBe("Diesel Plug-in Hybrid");
    expect(getFuelTypeFilterValues(filter!)).toEqual(["Diesel Plug-in Hybrid"]);
  });

  it("rejects removed generic values from URL filters", () => {
    expect(parseFuelTypeFilter("Hybrid")).toBeUndefined();
    expect(parseFuelTypeFilter("Plug-in Hybrid")).toBeUndefined();
  });

  it("keeps legacy values searchable through the explicit compatibility filter", () => {
    expect(getFuelTypeFilterValues(LEGACY_FUEL_TYPE_FILTER_VALUE)).toEqual([
      "Hybrid",
      "Plug-in Hybrid",
    ]);
  });
});
