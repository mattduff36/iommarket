import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalVehicle } from "@/scripts/dealer-stock-sync/types";
import { dealerFixture } from "./fixtures";

const harness = vi.hoisted(() => ({
  listed: [] as CanonicalVehicle[],
  fetchedIds: [] as Array<string | null>,
  detailsCalled: false,
  dropDetails: false,
}));

vi.mock("@/scripts/dealer-stock-sync/connectors/detect", () => ({
  getConnector: () => ({
    async fetchList() {
      return {
        dealerKey: "sample-motors",
        sourceKey: "used",
        platform: "unknown",
        status: "ok" as const,
        error: null,
        startUrl: "https://dealer.example/used",
        pagesFetched: 2,
        advertisedCount: harness.listed.length,
        rawCount: harness.listed.length,
        paginationUncertain: false,
        vehicles: harness.listed,
      };
    },
    async fetchDetails(_context: unknown, frozen: CanonicalVehicle[]) {
      harness.detailsCalled = true;
      harness.fetchedIds.push(...frozen.map((vehicle) => vehicle.sourceVehicleId));
      return {
        vehicles: (harness.dropDetails ? [] : frozen).map((vehicle) => ({ ...vehicle, description: "detail-enriched" })),
        detailMissing: frozen.filter((vehicle) => !vehicle.detailUrl).length,
      };
    },
  }),
}));

function card(overrides: Partial<CanonicalVehicle>): CanonicalVehicle {
  return {
    dealerKey: "sample-motors",
    sourceKey: "used",
    platform: "unknown",
    sourceVehicleId: null,
    registration: null,
    vin: null,
    stockReference: null,
    make: "Ford",
    model: "Focus",
    derivative: null,
    year: 2020,
    firstRegistrationDate: null,
    mileage: 1000,
    pricePence: 100,
    isPoa: false,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: null,
    colour: null,
    doors: null,
    seats: null,
    engineSize: null,
    enginePower: null,
    vehicleType: "Car",
    description: "list-card",
    locationName: null,
    detailUrl: "https://dealer.example/car",
    imageUrls: ["https://cdn.example/list.jpg"],
    availability: "available",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: "2026-10-22T18:00:00.000Z",
    provenance: { startUrl: "https://dealer.example/used", sourceKeys: ["used"], rawIdentityHints: [] },
    ...overrides,
  };
}

describe("sold list cards skip detail enrichment", () => {
  beforeEach(() => {
    harness.listed = [];
    harness.fetchedIds = [];
    harness.detailsCalled = false;
    harness.dropDetails = false;
  });

  it("keeps sold rows, skips stable source ids, and still enriches available cards", async () => {
    const { runDealerPipeline } = await import("@/scripts/dealer-stock-sync/pipeline");
    harness.listed = [
      card({ sourceVehicleId: "sold-1", availability: "sold", detailUrl: null, description: "sold-on-list" }),
      card({ sourceVehicleId: "live-1", availability: "available", description: "available-on-list" }),
      card({ sourceVehicleId: null, availability: "sold", detailUrl: null, description: "sold-without-id" }),
      card({ sourceVehicleId: "   ", availability: "sold", detailUrl: "https://dealer.example/blank", description: "blank-id" }),
    ];
    const dealer = dealerFixture({
      key: "sample-motors",
      connectorKey: "unknown",
      sources: [{
        key: "used",
        name: "Used",
        startUrl: "https://dealer.example/used",
        connectorKey: "unknown",
        required: true,
        dedicated: true,
      }],
    });
    const result = await runDealerPipeline(dealer, { delayMs: 0 });
    const source = result.sourceResults[0];
    expect(source?.vehicles.map((vehicle) => vehicle.description)).toEqual([
      "sold-on-list",
      "detail-enriched",
      "detail-enriched",
      "detail-enriched",
    ]);
    expect(harness.fetchedIds).toEqual(["live-1", null, "   "]);
    expect(source?.detailMissing).toBe(1);
    expect(source?.vehicles).toHaveLength(4);
    expect(source?.advertisedCount).toBe(4);
    expect(source?.pagesFetched).toBe(2);
    expect(source?.paginationUncertain).toBe(false);
    expect(source?.vehicles[0]?.imageUrls).toEqual(["https://cdn.example/list.jpg"]);
  });

  it("does not fetch details when every sold card already has a source id", async () => {
    const { runDealerPipeline } = await import("@/scripts/dealer-stock-sync/pipeline");
    harness.listed = [
      card({ sourceVehicleId: "sold-1", availability: "sold", detailUrl: null }),
      card({ sourceVehicleId: "sold-2", availability: "sold", detailUrl: null }),
    ];
    const dealer = dealerFixture({
      key: "sample-motors",
      connectorKey: "unknown",
      sources: [{
        key: "used",
        name: "Used",
        startUrl: "https://dealer.example/used",
        connectorKey: "unknown",
        required: true,
        dedicated: true,
      }],
    });
    const result = await runDealerPipeline(dealer, { delayMs: 0 });
    expect(harness.detailsCalled).toBe(false);
    expect(result.sourceResults[0]?.vehicles).toHaveLength(2);
    expect(result.sourceResults[0]?.detailMissing).toBe(0);
    expect(result.sourceResults[0]?.advertisedCount).toBe(2);
  });
});

it("does not hide missing available details when sold cards are skipped", async () => {
  const { runDealerPipeline } = await import("@/scripts/dealer-stock-sync/pipeline");
  harness.listed = [card({ sourceVehicleId: "sold", availability: "sold" }), card({ sourceVehicleId: "live" })];
  harness.dropDetails = true;
  const dealer = dealerFixture({ key: "sample-motors", connectorKey: "unknown", sources: [{ key: "used", name: "Used", startUrl: "https://dealer.example/used", connectorKey: "unknown", required: true, dedicated: true }] });
  const result = await runDealerPipeline(dealer, { delayMs: 0 });
  expect(result.sourceResults[0]?.detailMissing).toBe(1);
});
