import { describe, expect, it } from "vitest";
import { mapVehicleResultToListingAttributes } from "@/lib/listings/vehicle-autofill";
import type { VehicleCheckResult } from "@/lib/services/vehicle-check-types";

function buildResult(
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

describe("mapVehicleResultToListingAttributes", () => {
  const definitions = [
    { id: "make", slug: "make", name: "Make", dataType: "text", required: true, options: null },
    { id: "model", slug: "model", name: "Model", dataType: "text", required: true, options: null },
    { id: "year", slug: "year", name: "Year", dataType: "number", required: true, options: null },
    {
      id: "fuel",
      slug: "fuel-type",
      name: "Fuel Type",
      dataType: "select",
      required: false,
      options: JSON.stringify(["Petrol", "Diesel", "Electric", "Hybrid", "Plug-in Hybrid"]),
    },
    {
      id: "colour",
      slug: "colour",
      name: "Colour",
      dataType: "select",
      required: false,
      options: JSON.stringify(["Black", "White", "Silver", "Grey", "Blue", "Red"]),
    },
    { id: "mileage", slug: "mileage", name: "Mileage", dataType: "number", required: false, options: null },
    {
      id: "engine",
      slug: "engine-size",
      name: "Engine Size",
      dataType: "number",
      required: false,
      options: null,
    },
    {
      id: "co2",
      slug: "co2-emissions",
      name: "CO2 Emissions",
      dataType: "number",
      required: false,
      options: null,
    },
    {
      id: "tax",
      slug: "tax-per-year",
      name: "Tax Per Year",
      dataType: "number",
      required: false,
      options: null,
    },
  ];

  it("maps and normalizes supported fields", () => {
    const result = mapVehicleResultToListingAttributes({
      definitions,
      result: buildResult({
        vehicle: {
          registrationNumber: "AB12CDE",
          displayRegistrationNumber: "AB12 CDE",
          lookupPath: "uk",
          make: "MERCEDES BENZ",
          model: "A 200 AMG LINE",
          colour: "GRAY",
          fuelType: "PETROL",
          taxStatus: "Taxed",
          taxDueDate: null,
          motStatus: "Valid",
          motExpiryDate: null,
          yearOfManufacture: 2020,
          engineSizeCc: 1332,
          co2Emissions: 121,
          monthOfFirstRegistration: null,
          wheelPlan: null,
          euroStatus: null,
          category: null,
          previousUkRegistration: null,
          dateOfFirstRegistrationIom: null,
          roadTax12Month: "£195.00",
          roadTax6Month: null,
          firstUsedDate: null,
        },
        mileage: {
          latestMileage: 54321,
          latestMileageDate: "2025-01-01",
          earliestMileage: 22000,
          earliestMileageDate: "2022-01-01",
          averageAnnualMileage: 10000,
          points: [],
        },
      }),
    });

    expect(result.values).toMatchObject({
      make: "Mercedes-Benz",
      model: "A 200 AMG LINE",
      year: "2020",
      fuel: "Petrol",
      colour: "Grey",
      engine: "1.3",
      co2: "121",
      tax: "195",
    });
    expect(result.values.mileage).toBeUndefined();
    expect(result.appliedAttributeIds).toHaveLength(8);
  });

  it("uses MOT fallback values when vehicle payload is missing", () => {
    const result = mapVehicleResultToListingAttributes({
      definitions,
      result: buildResult({
        motHistory: {
          registrationNumber: "AB12CDE",
          sourceRegistrationNumber: null,
          make: "FORD",
          model: "FIESTA",
          firstUsedDate: null,
          fuelType: "DIESEL",
          primaryColour: "BLUE",
          motTests: [],
          motExpiryDate: null,
          motStatus: null,
          lastTestDate: null,
          lastTestResult: null,
        },
      }),
    });

    expect(result.values.make).toBe("Ford");
    expect(result.values.model).toBe("FIESTA");
    expect(result.values.fuel).toBe("Diesel");
    expect(result.values.colour).toBe("Blue");
  });

  it("skips unsupported values that cannot be normalized", () => {
    const result = mapVehicleResultToListingAttributes({
      definitions,
      result: buildResult({
        vehicle: {
          registrationNumber: "AB12CDE",
          displayRegistrationNumber: "AB12 CDE",
          lookupPath: "uk",
          make: "UNKNOWN MOTORS",
          model: null,
          colour: "PINK",
          fuelType: "HYDROGEN",
          taxStatus: null,
          taxDueDate: null,
          motStatus: null,
          motExpiryDate: null,
          yearOfManufacture: null,
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
      }),
    });

    expect(result.values).toEqual({});
    expect(result.appliedAttributeIds).toEqual([]);
  });
});
