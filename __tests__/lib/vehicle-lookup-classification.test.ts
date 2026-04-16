import { describe, expect, it } from "vitest";
import { inferCategorySlugFromLookupResult } from "@/app/(public)/sell/create-listing-form.helpers";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

function makeResult(
  overrides: Partial<VehicleCheckResult> = {}
): VehicleCheckResult {
  return {
    normalizedRegistration: "AB12CDE",
    displayRegistration: "AB12 CDE",
    isManx: false,
    lookupTargetRegistration: "AB12CDE",
    vehicle: null,
    motHistory: null,
    mileage: null,
    auctionHistory: null,
    warnings: [],
    sourceNotes: [],
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("inferCategorySlugFromLookupResult", () => {
  it("does not classify AVANT model names as vans", () => {
    const result = makeResult({
      vehicle: {
        registrationNumber: "AB12CDE",
        displayRegistrationNumber: "AB12 CDE",
        lookupPath: "uk",
        make: "Audi",
        model: "A4 Avant",
        colour: null,
        fuelType: null,
        taxStatus: null,
        taxDueDate: null,
        motStatus: null,
        motExpiryDate: null,
        yearOfManufacture: 2019,
        engineSizeCc: null,
        co2Emissions: null,
        monthOfFirstRegistration: null,
        wheelPlan: null,
        euroStatus: null,
        category: null,
        previousUkRegistration: null,
        dateOfFirstRegistrationIom: null,
        roadTax12Month: null,
        roadTax6Month: null,
        firstUsedDate: null,
      },
    });

    expect(inferCategorySlugFromLookupResult(result)).not.toBe("van");
  });

  it("does not classify CAR substrings inside other words as car", () => {
    const result = makeResult({
      vehicle: {
        registrationNumber: "AB12CDE",
        displayRegistrationNumber: "AB12 CDE",
        lookupPath: "uk",
        make: "Example",
        model: "Scarab",
        colour: null,
        fuelType: null,
        taxStatus: null,
        taxDueDate: null,
        motStatus: null,
        motExpiryDate: null,
        yearOfManufacture: 2018,
        engineSizeCc: null,
        co2Emissions: null,
        monthOfFirstRegistration: null,
        wheelPlan: null,
        euroStatus: null,
        category: null,
        previousUkRegistration: null,
        dateOfFirstRegistrationIom: null,
        roadTax12Month: null,
        roadTax6Month: null,
        firstUsedDate: null,
      },
    });

    expect(inferCategorySlugFromLookupResult(result)).not.toBe("car");
  });

  it("still classifies explicit van terms as van", () => {
    const result = makeResult({
      vehicle: {
        registrationNumber: "AB12CDE",
        displayRegistrationNumber: "AB12 CDE",
        lookupPath: "uk",
        make: "Ford",
        model: "Transit Van",
        colour: null,
        fuelType: null,
        taxStatus: null,
        taxDueDate: null,
        motStatus: null,
        motExpiryDate: null,
        yearOfManufacture: 2020,
        engineSizeCc: null,
        co2Emissions: null,
        monthOfFirstRegistration: null,
        wheelPlan: null,
        euroStatus: null,
        category: null,
        previousUkRegistration: null,
        dateOfFirstRegistrationIom: null,
        roadTax12Month: null,
        roadTax6Month: null,
        firstUsedDate: null,
      },
    });

    expect(inferCategorySlugFromLookupResult(result)).toBe("van");
  });
});
