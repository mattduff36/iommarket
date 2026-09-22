import { describe, expect, it } from "vitest";
import { resolveCategorySlug } from "../../../scripts/dealer-stock-sync/map-listing";
import { vehicle } from "./fixtures";

describe("FDP-MAP-001 category mapping", () => {
  it("maps bikes to motorbike and keeps cars and vans", () => {
    expect(resolveCategorySlug(vehicle({ vehicleType: "Motorcycle", sourceKey: "used-bikes" }))).toBe(
      "motorbike",
    );
    expect(resolveCategorySlug(vehicle({ vehicleType: "Bike", sourceKey: "used-bikes" }))).toBe("motorbike");
    expect(resolveCategorySlug(vehicle({ vehicleType: "Van", sourceKey: "used-vans" }))).toBe("van");
    expect(resolveCategorySlug(vehicle({ vehicleType: "Car", sourceKey: "used-cars" }))).toBe("car");
  });
});
