import { describe, expect, it } from "vitest";
import { getMakesWithDb } from "@/lib/constants/vehicle-makes";
import {
  canonicalizeKnownMake,
  normalizeMakeLookupKey,
} from "@/lib/vehicle-catalogue/make-canonicalization";
import {
  normalizeVehicleMakeModel,
  normalizeVehicleModel,
} from "@/lib/vehicle-catalogue/vehicle-normalization";
import {
  buildVehicleInventory,
  matchingVehicleListingIds,
} from "@/lib/search/vehicle-inventory";

describe("shared vehicle identity normalization", () => {
  it.each([
    [" FORD ", "Ford"], ["MINI", "Mini"], ["seat", "Seat"], ["CUPRA", "Cupra"],
    ["JAECOO", "Jaecoo"], ["bmw", "BMW"], ["mg", "MG"], ["ktm", "KTM"],
    ["ldv", "LDV"], ["MCLAREN", "McLaren"], ["SSANGYONG", "SsangYong"],
    ["Merc", "Mercedes-Benz"], ["Mercedes Benz", "Mercedes-Benz"],
    ["Mercedes AMG", "Mercedes-Benz"], ["VW", "Volkswagen"],
    ["Škoda", "Skoda"], ["DS", "DS Automobiles"], ["Range Rover", "Land Rover"],
    ["constructor", "Constructor"],
  ])("canonicalizes make %s without duplicate labels", (raw, expected) => {
    expect(canonicalizeKnownMake(raw)).toBe(expected);
    expect(normalizeMakeLookupKey(raw)).toBe(normalizeMakeLookupKey(expected));
  });

  it("deduplicates constant and database make aliases", () => {
    const makes = getMakesWithDb(["FORD", "ford", "VW", "Škoda", "DS", "MINI", "KTM", "ktm"]);
    expect(makes.filter((make) => make === "Ford")).toHaveLength(1);
    expect(makes).toContain("Volkswagen");
    expect(makes).toContain("Skoda");
    expect(makes).toContain("DS Automobiles");
    expect(makes).toContain("Mini");
    expect(makes.filter((make) => make === "KTM")).toHaveLength(1);
    expect(makes).not.toContain("VW");
    expect(makes).not.toContain("FORD");
  });

  it.each([
    ["Mercedes", "A Class AMG LINE", "A-Class AMG Line"],
    ["Jaguar", "F - Pace R SPORT", "F-Pace R Sport"],
    ["Honda", "CRV EX", "CR-V EX"],
    ["Honda", "cr - v EX", "CR-V EX"],
    ["Yamaha", "MT03", "MT-03"],
    ["Hyundai", "I10 SE", "i10 SE"],
    ["Volkswagen", "GOLF GTI", "Golf GTI"],
    ["BMW", "320d M SPORT", "320d M Sport"],
    ["Porsche", "S", "S"],
    ["Mercedes-Benz", "AMG LINE", "AMG Line"],
    ["Citroen", "D SPORT AUTO", "D Sport Auto"],
    ["Land Rover", "SE P300E A", "SE P300E A"],
    ["Unknown Works", "CRV", "CRV"],
    ["Ford", "MT03", "MT03"],
    ["Unknown Works", "One-Off", "One-Off"],
    ["Ford", "constructor", "Constructor"],
    ["Audi", "tt COUPE S LINE", "TT Coupe S Line"],
    ["Audi", "q2", "Q2"],
    ["Mercedes-Benz", "glc 220D 4MATIC", "GLC 220D 4Matic"],
    ["Mercedes-Benz", "C200d AMG", "C200d AMG"],
    ["Land Rover", "Range Rover Evoque P300e", "Range Rover Evoque P300e"],
    ["Ford", "ECOSPORT 1.0 ECOBOOST MHEV 5Dr", "EcoSport 1.0 EcoBoost MHEV 5dr"],
    ["Kia", "X-CEED", "XCeed"],
    ["Hyundai", "IX35 CRDI", "ix35 CRDi"],
    ["Toyota", "HI-LUX", "Hilux"],
    ["Peugeot", "ION", "iOn"],
    ["Honda", "JAZZ i-VTEC", "Jazz i-VTEC"],
    ["Mercedes-Benz", "A-CLASS AMG A 45 S 4MATIC&#x2B; PLUS AUTO", "A-Class AMG A 45 S 4Matic+ Plus Auto"],
  ])("formats %s %s without inferring another model", (make, model, expected) => {
    expect(normalizeVehicleModel(make, model)).toBe(expected);
  });

  it.each([
    ["Mercedes AMG", "C63", "Mercedes-Benz", "C63 AMG"],
    ["Mercedes-AMG", "AMG GT", "Mercedes-Benz", "AMG GT"],
    ["Range Rover", "EVOQUE D180 SE", "Land Rover", "Range Rover Evoque D180 SE"],
    ["Range Rover", "RANGE ROVER SPORT", "Land Rover", "Range Rover Sport"],
    ["Range Rover", "DISCOVERY SPORT", "Land Rover", "Discovery Sport"],
    ["Land Rover", "RANGE ROVER DISCOVERY", "Land Rover", "Discovery"],
    ["Land Rover", "EVOQUE", "Land Rover", "Range Rover Evoque"],
  ])("retains identity information from %s %s", (make, model, expectedMake, expectedModel) => {
    expect(normalizeVehicleMakeModel(make, model)).toEqual({
      make: expectedMake, model: expectedModel,
    });
  });

  it("is pure, idempotent, and leaves missing values missing", () => {
    const inputs = [
      ["MERCEDES AMG", "A CLASS AMG LINE"], ["Range Rover", "Discovery Sport"],
      ["Range Rover", "Velar SE"], ["Honda", "CRV"], ["Ford", "FOCUS ST-LINE"],
      ["Unknown Works", "One-Off 99x"], [null, null], ["", " "],
    ] as const;
    for (const [make, model] of inputs) {
      const once = normalizeVehicleMakeModel(make, model);
      expect(normalizeVehicleMakeModel(once.make, once.model)).toEqual(once);
    }
    expect(normalizeVehicleMakeModel(null, null)).toEqual({ make: null, model: null });
    expect(normalizeVehicleMakeModel("Range Rover", null).model).toBeNull();
  });
});

describe("canonical public inventory and legacy filtering", () => {
  const rows = [
    { listingId: "a", make: "FORD", model: "FOCUS ST-LINE" },
    { listingId: "b", make: "Ford", model: "Focus ST-Line" },
    { listingId: "c", make: "Ford", model: "Focus Titanium" },
    { listingId: "d", make: "Range Rover", model: "EVOQUE" },
    { listingId: "e", make: "Land Rover", model: "Range Rover Evoque" },
    { listingId: "f", make: "Range Rover", model: "Discovery Sport" },
    { listingId: "g", make: "Honda", model: "CRV" },
    { listingId: "h", make: "HONDA", model: "CR - V" },
    { listingId: "i", make: "Porsche", model: "S" },
    { listingId: "j", make: "Porsche", model: "Cayman S" },
    { listingId: "k", make: "VW", model: "Golf GTI" },
    { listingId: "l", make: "Volkswagen", model: "GOLF GTI" },
  ];

  it("combines alias counts, not trim distinctions or unrelated models", () => {
    const inventory = buildVehicleInventory(rows);
    expect(inventory.makes.find((make) => make.value === "Ford")?.count).toBe(3);
    expect(inventory.modelsByMake.Ford).toEqual(["Focus ST-Line", "Focus Titanium"]);
    expect(inventory.modelCountsByMake.Ford["Focus ST-Line"]).toBe(2);
    expect(inventory.modelCountsByMake.Honda["CR-V"]).toBe(2);
    expect(inventory.modelCountsByMake["Land Rover"]["Range Rover Evoque"]).toBe(2);
    expect(inventory.modelCountsByMake["Land Rover"]["Discovery Sport"]).toBe(1);
    expect(inventory.modelsByMake.Porsche).toEqual(["Cayman S", "S"]);
    expect(inventory.makes.find((make) => make.value === "Volkswagen")?.count).toBe(2);
  });

  it.each([
    [{ make: "ford", model: "Focus ST-Line" }, ["a", "b"]],
    [{ make: "VW", model: "GOLF GTI" }, ["k", "l"]],
    [{ make: "Volkswagen" }, ["k", "l"]],
    [{ make: "Land Rover", model: "Range Rover Evoque" }, ["d", "e"]],
    [{ make: "Range Rover", model: "EVOQUE" }, ["d", "e"]],
    [{ make: "Land Rover", model: "Discovery Sport" }, ["f"]],
    [{ make: "Honda", model: "CR-V" }, ["g", "h"]],
    [{ model: "CRV" }, ["g", "h"]],
    [{ make: "Porsche", model: "S" }, ["i"]],
    [{ make: "Ford", model: "Not a model" }, []],
  ])("matches legacy values for %j", (selection, expected) => {
    expect(matchingVehicleListingIds(rows, selection)).toEqual(expected);
  });

  it("does not strip arbitrary punctuation or merge unknown codes", () => {
    const unknown = [
      { listingId: "1", make: "Ford", model: "AB-12" },
      { listingId: "2", make: "Ford", model: "AB12" },
      { listingId: "3", make: "Ford", model: "A B12" },
    ];
    expect(matchingVehicleListingIds(unknown, { make: "Ford", model: "AB-12" })).toEqual(["1"]);
    expect(buildVehicleInventory(unknown).modelsByMake.Ford).toHaveLength(3);
    expect(rows[0]).toEqual({ listingId: "a", make: "FORD", model: "FOCUS ST-LINE" });
  });
});
