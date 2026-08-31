import { describe, expect, it } from "vitest";
import { applyDetailEnrichment } from "../../../scripts/dealer-stock-sync/connectors/netdirector/enrich";
import {
  extractSearchVehicles,
  extractTotalPages,
  parseNetDirectorVehicle,
  vehicleIdentityToken,
} from "../../../scripts/dealer-stock-sync/connectors/netdirector/normalize";
import {
  paginateClassicListing,
  paginateVehicleSearch,
  withPageNumber,
} from "../../../scripts/dealer-stock-sync/connectors/netdirector/pagination";
import { netdirectorConnector } from "../../../scripts/dealer-stock-sync/connectors/netdirector";
import { dealerFixture } from "./fixtures";

describe("netdirector pagination", () => {
  it("increments GraphQL currentPage independently of JSON page fields", () => {
    const body = JSON.stringify({
      query: "query { getAll (pagination: {currentPage: 1, pageSize: 12}) { id } }",
    });
    expect(withPageNumber(body, 4)).toContain("currentPage: 4");
  });

  it("paginates the newer vehicle-search API to completion", async () => {
    const pages = new Map<number, unknown>([
      [1, { vehicles: [{ id: "1", manufacturer: "Ford", model: "Focus" }], pagination: { page: 1, totalPages: 2 } }],
      [2, { vehicles: [{ id: "2", manufacturer: "Ford", model: "Puma" }], pagination: { page: 2, totalPages: 2 } }],
    ]);
    const fetchImpl: typeof fetch = async (_url, init) => {
      const page = JSON.parse(String(init?.body ?? '{"page":1}')).page ?? 1;
      return new Response(JSON.stringify(pages.get(page)), { status: 200 });
    };
    const result = await paginateVehicleSearch({
      context: { apiUrl: "https://search.example", uuid: "abc" },
      fetchImpl,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.vehicles).toHaveLength(2);
    expect(extractSearchVehicles(pages.get(1))).toHaveLength(1);
    expect(extractTotalPages(pages.get(1), 1)).toBe(2);
  });

  it("paginates classic stock-listing get-items until hasMoreResults is false", async () => {
    const pages = new Map([
      [
        1,
        {
          count: 3,
          perPage: 2,
          hasMoreResults: true,
          vehicles: [
            { id: "1", make: "Ford", model: "Focus" },
            { id: "2", make: "Ford", model: "Puma" },
          ],
        },
      ],
      [
        2,
        {
          count: 3,
          perPage: 2,
          hasMoreResults: false,
          vehicles: [{ id: "3", make: "Ford", model: "Kuga" }],
        },
      ],
    ]);
    const fetchImpl: typeof fetch = async (url) => {
      const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
      return new Response(JSON.stringify(pages.get(page)), { status: 200 });
    };
    const result = await paginateClassicListing({
      captured: {
        url: "https://www.atholgarage.com/ajax/stock-listing/get-items?page=1",
        method: "GET",
        headers: {},
        body: null,
      },
      fetchImpl,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.vehicles).toHaveLength(3);
  });

  it("normalizes NetDirector cards and rejects malformed records", () => {
    const athol = dealerFixture();
    const context = { dealer: athol, source: athol.sources[0]! };
    const normalized = netdirectorConnector.normalize(
      {
        id: "1742",
        manufacturer: "Kia",
        model: "Sportage",
        productionYear: 2024,
        odometer: { value: 8000 },
        price: { current: 28995, isPoa: false },
        location: { name: "Athol Garage" },
      },
      context,
    );
    expect(normalized?.make).toBe("Kia");
    expect(normalized?.pricePence).toBe(2_899_500);
    expect(normalized?.dealerKey).toBe("athol-garage");
    expect(parseNetDirectorVehicle({ hello: true })).toBeNull();
    expect(netdirectorConnector.normalize({ hello: true }, context)).toBeNull();
  });

  it("does not let the detail phase add new list IDs", () => {
    const frozen = [{ make: "Ford", model: "Focus", year: 2022, mileage: 1, stockId: "keep" }];
    const details = new Map([
      [vehicleIdentityToken(frozen[0]!), frozen[0]!],
      ["extra", { make: "Ford", model: "Puma", year: 2021, mileage: 2, stockId: "extra" }],
    ]);
    expect(() => applyDetailEnrichment(frozen, details)).toThrow("Detail phase introduced new vehicles");
  });
});
