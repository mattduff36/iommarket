import { describe, expect, it } from "vitest";
import { mapReconciledVehicle, resolveCategorySlug } from "../../../scripts/dealer-stock-sync/map-listing";
import { inventoryFromReconciled } from "../../../scripts/dealer-stock-sync/to-inventory";
import type { ReconciledVehicle } from "../../../scripts/dealer-stock-sync/types";
import { vehicle } from "./fixtures";

function reconciled(overrides: Parameters<typeof vehicle>[0] = {}): ReconciledVehicle {
  const current = vehicle(overrides);
  return {
    identityKey: "sourceVehicleId:stock-1",
    identityKind: "sourceVehicleId",
    sources: [current.sourceKey],
    preferredSource: current.sourceKey,
    vehicle: current,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "hash",
  };
}

describe("FDP-MAP-001 category mapping", () => {
  it("holds contradictory source transmissions without misreading AUTO TRAIL as automatic", () => {
    expect(inventoryFromReconciled([reconciled({ model: "PICANTO", derivative: "1.0 AUTOMATIC", transmission: "Manual" })])[0]?.skipReason).toBe("source-transmission-conflict");
    expect(inventoryFromReconciled([reconciled({ model: "Polo Manual", transmission: "Automatic" })])[0]?.skipReason).toBe("source-transmission-conflict");
    expect(inventoryFromReconciled([reconciled({ model: "AUTO TRAIL Cheyenne", transmission: "Manual" })])[0]?.skipReason).not.toBe("source-transmission-conflict");
  });
  it("maps bikes to motorbike and keeps cars and vans", () => {
    expect(resolveCategorySlug(vehicle({ vehicleType: "Motorcycle", sourceKey: "used-bikes" }))).toBe(
      "motorbike",
    );
    expect(resolveCategorySlug(vehicle({ vehicleType: "Bike", sourceKey: "used-bikes" }))).toBe("motorbike");
    expect(resolveCategorySlug(vehicle({ vehicleType: "Van", sourceKey: "used-vans" }))).toBe("van");
    expect(resolveCategorySlug(vehicle({ vehicleType: "Car", sourceKey: "used-cars" }))).toBe("car");
    expect(resolveCategorySlug(vehicle({ model: "V80", vehicleType: null, sourceKey: "used-vans" }))).toBe("van");
    expect(resolveCategorySlug(vehicle({ model: "HI-LUX", derivative: "Invincible X Pickup Double Cab", vehicleType: null, sourceKey: "used-cars" }))).toBe("van");
  });

  it("classifies clear motorhome and camper model tokens as motorhomes", () => {
    const models = [
      "COACHMAN Kabe 545 Travelmaster Coachman",
      "ELDDIS 120 ACCORDO having only covered 7,800 miles",
      "ROLLER TEAM ZEFIRO 675",
      "TRANSPORTER 2.0 TDI 4 Berth Camper Van",
      "SPRINTER 2.1 313 CDi Camper Van 2 Berth",
      "AUTO TRAIL Cheyenne 4 berth",
      "DETHLEFFS ESPRIT A-CLASS",
      "BURSTNER Lyseo 744 Harmony Line",
      "EURO-MOBIL FENDT K500",
      "Crafter CR35 MWB High Roof 2.0 TDI 140 Trendline Camper",
    ];
    for (const model of models) {
      const outcome = mapReconciledVehicle(
        reconciled({
          dealerKey: "mikes-motors",
          make: "FORD",
          model,
          vehicleType: "Van",
          sourceKey: "used-vans",
          transmission: null,
          bodyType: null,
        }),
      );
      expect(outcome.skipReason).toBeNull();
      expect(outcome.listing?.categorySlug).toBe("motorhome");
      expect(outcome.listing?.attributes.transmission).toBeUndefined();
    }
  });

  it("recognises motorhome makers when they are split from the model", () => {
    expect(resolveCategorySlug(vehicle({ make: "Burstner", model: "Lyseo 744 Harmony Line" }))).toBe("motorhome");
    expect(resolveCategorySlug(vehicle({ make: "Euro-Mobil", model: "FENDT K500" }))).toBe("motorhome");
  });

  it("does not treat the base vehicle make as a motorhome", () => {
    expect(resolveCategorySlug(vehicle({ make: "Swift", model: "Voyager 584", bodyType: "MOTORHOME", vehicleType: "LCV" }))).toBe("motorhome");
    expect(resolveCategorySlug(vehicle({ make: "Swift", model: "Merlin164", bodyType: "Camper Van", vehicleType: "LCV" }))).toBe("motorhome");
    expect(
      resolveCategorySlug(
        vehicle({ dealerKey: "mikes-motors", make: "MERCEDES-BENZ", model: "Sprinter", vehicleType: "Van" }),
      ),
    ).toBe("van");
    expect(
      resolveCategorySlug(
        vehicle({ dealerKey: "mikes-motors", make: "FORD", model: "Transit Custom", vehicleType: "Van" }),
      ),
    ).toBe("van");
    expect(
      resolveCategorySlug(
        vehicle({ dealerKey: "mikes-motors", make: "PEUGEOT", model: "208", vehicleType: "Car" }),
      ),
    ).toBe("car");
  });

  it("keeps motorhome stock out of the car and van inventory categories", () => {
    const [item] = inventoryFromReconciled([
      reconciled({
        dealerKey: "mikes-motors",
        make: "MERCEDES-BENZ",
        model: "SPRINTER Camper Van",
        vehicleType: "LCV",
        bodyType: "Camper Van",
      }),
    ]);
    expect(item?.categorySlug).toBe("motorhome");
    expect(item?.importable).toBe(true);
  });
});
