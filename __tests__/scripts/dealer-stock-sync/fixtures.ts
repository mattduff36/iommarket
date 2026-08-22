import type { CanonicalVehicle, DealerRecord, SourceListResult } from "../../../scripts/dealer-stock-sync/types";

export function vehicle(overrides: Partial<CanonicalVehicle> = {}): CanonicalVehicle {
  return {
    dealerKey: "ocean-motor-village",
    sourceKey: "ocean-ford",
    platform: "netdirector",
    sourceVehicleId: "stock-1",
    registration: "MAN123",
    vin: null,
    stockReference: "stock-1",
    make: "Ford",
    model: "Focus",
    derivative: "ST-Line",
    year: 2022,
    firstRegistrationDate: null,
    mileage: 12000,
    pricePence: 1_850_000,
    isPoa: false,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: "Blue",
    doors: 5,
    seats: 5,
    engineSize: 1,
    enginePower: 123,
    vehicleType: "Car",
    description: "A well specified Ford Focus with service history.",
    locationName: "Ocean Ford",
    detailUrl: "https://www.oceanford.com/used-cars/focus/",
    imageUrls: ["https://cdn.example.com/a.jpg"],
    availability: "available",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: "2026-08-22T12:00:00.000Z",
    provenance: {
      startUrl: "https://www.oceanford.com/used-cars/ocean-ford/",
      sourceKeys: ["ocean-ford"],
      rawIdentityHints: ["stock-1", "MAN123"],
    },
    ...overrides,
  };
}

export function sourceResult(
  overrides: Partial<SourceListResult> & Pick<SourceListResult, "sourceKey" | "vehicles">,
): SourceListResult {
  return {
    dealerKey: "ocean-motor-village",
    platform: "netdirector",
    status: "ok",
    error: null,
    startUrl: "https://example.com",
    pagesFetched: 1,
    advertisedCount: null,
    rawCount: overrides.vehicles.length,
    ...overrides,
  };
}

export function dealerFixture(overrides: Partial<DealerRecord> = {}): DealerRecord {
  return {
    key: "athol-garage",
    displayName: "Athol Garage",
    status: "confirmed",
    website: "https://www.athol.im/",
    stockUrls: ["https://www.athol.im/used-cars/"],
    platformHint: "NetDirector",
    connectorKey: "netdirector",
    groupKey: null,
    locations: [],
    sources: [
      {
        key: "used-cars",
        name: "Athol used cars",
        startUrl: "https://www.athol.im/used-cars/",
        connectorKey: "netdirector",
        required: true,
        dedicated: true,
      },
    ],
    notes: "",
    lastVerifiedAt: null,
    ...overrides,
  };
}
