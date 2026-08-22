import { describe, expect, it } from "vitest";
import { compareSnapshot, identityFor, missingAfterSuccess } from "../../../scripts/dealer-stock-sync/identity";
import { reconcileDealerVehicles, reconcileSourceCounts } from "../../../scripts/dealer-stock-sync/reconcile";
import { sourceResult, vehicle } from "./fixtures";

describe("dealer stock identity", () => {
  it("prefers source id, then VIN, then registration, and never uses price", () => {
    expect(identityFor(vehicle())?.kind).toBe("sourceVehicleId");
    expect(identityFor(vehicle({ sourceVehicleId: null }))?.kind).toBe("registration");
    expect(identityFor(vehicle({ sourceVehicleId: null, registration: null, vin: "WVWZZZ" }))?.kind).toBe("vin");
    const left = identityFor(vehicle({ pricePence: 1_000_000 }));
    const right = identityFor(vehicle({ pricePence: 2_000_000, mileage: 99_000 }));
    expect(left?.key).toBe(right?.key);
  });

  it("does not treat a mileage or price change as a new identity", () => {
    const first = identityFor(vehicle({ mileage: 10_000, pricePence: 1_000_000 }));
    const second = identityFor(vehicle({ mileage: 12_000, pricePence: 1_200_000 }));
    expect(first?.key).toBe(second?.key);
  });

  it("keeps both records when stable IDs conflict", () => {
    const reconciled = reconcileDealerVehicles([
      sourceResult({
        sourceKey: "omv",
        vehicles: [vehicle({ sourceVehicleId: "same", registration: "AAA111", sourceKey: "omv" })],
      }),
      sourceResult({
        sourceKey: "ocean-kia",
        vehicles: [vehicle({ sourceVehicleId: "same", registration: "BBB222", sourceKey: "ocean-kia" })],
      }),
    ]);
    expect(reconciled).toHaveLength(2);
    expect(reconciled.every((item) => item.identityConflict)).toBe(true);
  });

  it("dedupes the same vehicle across Ocean group sources", () => {
    const reconciled = reconcileDealerVehicles([
      sourceResult({
        sourceKey: "omv",
        vehicles: [vehicle({ sourceKey: "omv", description: "short" })],
      }),
      sourceResult({
        sourceKey: "ocean-ford",
        vehicles: [vehicle({ sourceKey: "ocean-ford", description: "Much longer dedicated copy." })],
      }),
    ]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.sources).toEqual(["omv", "ocean-ford"]);
    expect(reconciled[0]?.vehicle.description).toContain("dedicated");
  });

  it("reports advertised count shortfalls and does not treat a failed source as sold", () => {
    expect(
      reconcileSourceCounts([
        sourceResult({
          sourceKey: "used-cars",
          vehicles: [vehicle()],
          advertisedCount: 3,
          rawCount: 1,
        }),
      ]),
    ).toContain("used-cars: retrieved 1 < advertised 3");
    expect(compareSnapshot([{ identityKey: "a", contentHash: "1" }], { identityKey: "a", contentHash: "1" }, true)).toBe(
      "source_failed",
    );
    expect(missingAfterSuccess([{ identityKey: "gone" }], new Set(), true)).toEqual([]);
    expect(missingAfterSuccess([{ identityKey: "gone" }], new Set(), false)).toEqual(["gone"]);
  });
});
