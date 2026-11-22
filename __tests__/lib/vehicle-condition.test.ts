import { updateListingSchema } from "@/lib/validations/listing";
import { describe, expect, it } from "vitest";
import { explicitVehicleCondition, resolveConditionEvidence, stockRouteCondition } from "@/lib/listings/condition";
import { normalizeSearchParams } from "@/lib/search/search-url";
import { buildRevisionFieldDiffs } from "@/lib/listings/revision-preview";

describe("vehicle condition", () => {
  it("does not reset condition when an older update caller omits it", () => {
    expect(updateListingSchema.parse({ id: "clxxxxxxxxxxxxxxxxxxxxxxx" }).condition).toBeUndefined();
  });
  it("accepts authoritative metadata without inferring from age, mileage or advert copy", () => {
    expect(explicitVehicleCondition("https://schema.org/NewCondition")).toBe("NEW");
    expect(explicitVehicleCondition("used")).toBe("USED");
    for (const input of [0, "0 miles", "2026", "New arrival", "Like new", null]) {
      expect(explicitVehicleCondition(input)).toBeNull();
    }
  });
  it("uses explicit stock routes without treating latest stock filenames as New", () => {
    expect(stockRouteCondition("https://www.athol.im/used-cars/ford-focus/1")).toBe("USED");
    expect(stockRouteCondition("https://www.oceanford.com/transit-centre/used-vans/")).toBe("USED");
    expect(stockRouteCondition("https://www.mikesmotors.im/used-fiat-burstner-castletown-isle-of-man-8219912")).toBe("USED");
    expect(stockRouteCondition("https://www.example.com/new-cars/stock/123")).toBe("NEW");
    expect(stockRouteCondition("https://www.dwcars.info/cars_new.html")).toBeNull();
    expect(stockRouteCondition("https://www.vanmossel.im/motormall")).toBeNull();
  });
  it("keeps missing or conflicting evidence flagged for review", () => {
    expect(resolveConditionEvidence([])).toEqual({ condition: "USED", reviewRequired: true });
    expect(resolveConditionEvidence(["NEW", "USED"])).toEqual({ condition: "USED", reviewRequired: true });
    expect(resolveConditionEvidence(["NEW", "newcondition"])).toEqual({ condition: "NEW", reviewRequired: false });
  });
  it("preserves valid filters and rejects invalid conditions across categories", () => {
    for (const category of ["car", "van", "motorbike", "motorhome"]) {
      expect(normalizeSearchParams({ category, condition: "NEW" }).condition).toBe("NEW");
    }
    expect(normalizeSearchParams({ condition: "arbitrary" }).condition).toBeUndefined();
  });
  it("shows condition changes in moderation comparison", () => {
    const base = { title: "Car", description: "Description", price: 100, categoryName: "Cars", regionName: "IOM", attributes: [], imagePublicIds: [] };
    expect(buildRevisionFieldDiffs({ ...base, condition: "USED" }, { ...base, condition: "NEW" })).toEqual([
      { field: "Condition", live: "USED", proposed: "NEW" },
    ]);
  });
});
