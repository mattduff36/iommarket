import { describe, expect, it } from "vitest";
import { classifyLocation, isOceanEligibleLocation } from "../../scripts/import-ocean-inventory/locations";
import {
  buildTitle,
  mapColour,
  mapFuelType,
  mapReconciledVehicle,
  mapTransmission,
  poundsToPence,
  resolveCategorySlug,
  uniqueImageUrls,
} from "../../scripts/import-ocean-inventory/map-vehicle";
import {
  extractSearchVehicles,
  extractTotalPages,
  normalizeNetDirectorVehicle,
} from "../../scripts/import-ocean-inventory/normalize";
import { runImportPipeline } from "../../scripts/import-ocean-inventory/pipeline";
import {
  liveInsertBlockedReason,
  omvLowerBoundWarning,
  reconcileVehicles,
} from "../../scripts/import-ocean-inventory/reconcile";
import { formatImportReport } from "../../scripts/import-ocean-inventory/report";
import { extractGalleryFromHtml, withPageQuery } from "../../scripts/import-ocean-inventory/classic";
import {
  applyDetailEnrichment,
  paginateClassicListing,
  paginateVehicleSearch,
  withPageNumber,
} from "../../scripts/import-ocean-inventory/scrape";
import { OCEAN_SOURCES } from "../../scripts/import-ocean-inventory/sources";
import {
  EXPECTED_PRO_CAP,
  IMPORT_DEALER_EMAIL,
  IMPORT_DEALER_NAME,
  assertPreviewImportTarget,
} from "../../scripts/import-ocean-inventory/target";
import type { NormalizedVehicle, SourceListResult } from "../../scripts/import-ocean-inventory/types";
import { vehicleIdentityToken } from "../../scripts/import-ocean-inventory/normalize";

function vehicle(overrides: Partial<NormalizedVehicle> = {}): NormalizedVehicle {
  return {
    sourceKey: "ocean-ford",
    stockId: "stock-1",
    registration: "MAN123",
    stockReference: "stock-1",
    detailUrl: "https://www.oceanford.com/used-cars/focus/",
    make: "Ford",
    model: "Focus",
    derivative: "ST-Line",
    year: 2022,
    mileage: 12000,
    pricePence: 1_850_000,
    isPoa: false,
    locationName: "Ocean Ford",
    vehicleType: "Car",
    description: "A well specified Ford Focus with service history and two keys.",
    imageUrls: ["https://cdn.example.com/a.jpg"],
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: "Blue",
    doors: 5,
    seats: 5,
    engineSize: 1,
    enginePower: 123,
    ...overrides,
  };
}

function sourceResult(
  overrides: Partial<SourceListResult> & Pick<SourceListResult, "sourceKey" | "vehicles">,
): SourceListResult {
  return {
    status: "ok",
    error: null,
    startUrl: "https://example.com",
    pagesFetched: 1,
    rawCount: overrides.vehicles.length,
    ...overrides,
  };
}

describe("import ocean inventory locations", () => {
  it("includes only Ocean Ford, Transit Centre, and Ocean KIA", () => {
    expect(classifyLocation("Ocean Ford")).toEqual({
      kind: "include",
      canonical: "Ocean Ford",
    });
    expect(classifyLocation("Ocean Ford - Transit Centre")).toEqual({
      kind: "include",
      canonical: "Ocean Ford - Transit Centre",
    });
    expect(classifyLocation("Ocean KIA")).toEqual({
      kind: "include",
      canonical: "Ocean KIA",
    });
    expect(isOceanEligibleLocation("Bentley Motor Group - Keighley")).toBe(false);
    expect(isOceanEligibleLocation("Keighley Mazda")).toBe(false);
    expect(isOceanEligibleLocation("BnB Motorhomes")).toBe(false);
    expect(isOceanEligibleLocation("Ocean Citroën")).toBe(false);
    expect(isOceanEligibleLocation("4Hire")).toBe(false);
    expect(isOceanEligibleLocation("Ocean Ford Keighley")).toBe(false);
  });
});

describe("import ocean inventory mapper", () => {
  it("converts pounds to pence and skips POA", () => {
    expect(poundsToPence(18500)).toBe(1_850_000);
    const poa = mapReconciledVehicle({
      identityKey: "stockId:1",
      identityKind: "stockId",
      sources: ["ocean-ford"],
      preferredSource: "ocean-ford",
      locationName: "Ocean Ford",
      vehicle: vehicle({ isPoa: true, pricePence: null }),
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
    });
    expect(poa.skipReason).toBe("poa");
    expect(poa.listing).toBeNull();
  });

  it("maps vans from Transit Centre and fuel/transmission colours", () => {
    expect(resolveCategorySlug({ locationName: "Ocean Ford - Transit Centre", vehicleType: "Car" })).toBe(
      "van",
    );
    expect(resolveCategorySlug({ locationName: "Ocean Ford", vehicleType: "Van" })).toBe("van");
    expect(mapFuelType("Petrol Plug-in Hybrid")).toBe("Petrol Plug-in Hybrid");
    expect(mapTransmission("DSG")).toBe("Automatic");
    expect(mapColour("Magnetic Grey")).toBe("Grey");
    expect(buildTitle(vehicle()).length).toBeGreaterThanOrEqual(5);
  });

  it("dedupes image URLs and caps at 20", () => {
    const urls = [
      ...Array.from({ length: 25 }, (_, index) => `https://cdn.example.com/${index}.jpg`),
      "https://cdn.example.com/0.jpg",
      "//cdn.example.com/1.jpg",
    ];
    expect(uniqueImageUrls(urls)).toHaveLength(20);
  });
});

describe("import ocean inventory scrape helpers", () => {
  it("keeps independent source configurations", () => {
    expect(OCEAN_SOURCES.map((source) => source.key)).toEqual([
      "omv",
      "ocean-ford",
      "transit-centre",
      "ocean-kia",
    ]);
    expect(new Set(OCEAN_SOURCES.map((source) => source.startUrl)).size).toBe(4);
    expect(OCEAN_SOURCES.filter((source) => source.required).map((source) => source.key)).toEqual([
      "ocean-ford",
      "transit-centre",
      "ocean-kia",
    ]);
  });

  it("increments GraphQL currentPage independently of JSON page fields", () => {
    const body = JSON.stringify({
      query: "query { getAll (pagination: {currentPage: 1, pageSize: 12}) { id } }",
    });
    expect(withPageNumber(body, 4)).toContain("currentPage: 4");
    expect(withPageQuery("https://example.com/ajax/stock-listing/get-items?page=1", 2)).toContain(
      "page=2",
    );
  });

  it("paginates each source to completion from the API payload", async () => {
    const pages = new Map<number, unknown>([
      [
        1,
        {
          vehicles: [{ id: "1", manufacturer: "Ford", model: "Focus" }],
          pagination: { page: 1, totalPages: 2 },
        },
      ],
      [
        2,
        {
          vehicles: [{ id: "2", manufacturer: "Ford", model: "Puma" }],
          pagination: { page: 2, totalPages: 2 },
        },
      ],
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
    expect(extractSearchVehicles(pages.get(1))).toHaveLength(1);
    expect(extractTotalPages(pages.get(1), 1)).toBe(2);
    expect(result.vehicles).toHaveLength(2);
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
            { id: "1", make: "Ford", model: "Focus", location_name: "Ocean Ford" },
            { id: "2", make: "Ford", model: "Puma", location_name: "Ocean Ford" },
          ],
        },
      ],
      [
        2,
        {
          count: 3,
          perPage: 2,
          hasMoreResults: false,
          vehicles: [{ id: "3", make: "Ford", model: "Kuga", location_name: "Keighley Mazda" }],
        },
      ],
    ]);
    const fetchImpl: typeof fetch = async (url) => {
      const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
      return new Response(JSON.stringify(pages.get(page)), { status: 200 });
    };
    const result = await paginateClassicListing({
      captured: {
        url: "https://www.oceanford.com/ajax/stock-listing/get-items?page=1",
        method: "GET",
        headers: {},
        body: null,
      },
      fetchImpl,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.vehicles).toHaveLength(3);
  });

  it("does not let the detail phase add new list IDs", () => {
    const frozen = [vehicle({ stockId: "keep" })];
    const details = new Map([
      [vehicleIdentityToken(frozen[0]), vehicle({ stockId: "keep", description: "longer detail copy here" })],
      ["extra", vehicle({ stockId: "extra" })],
    ]);
    expect(() => applyDetailEnrichment(frozen, details)).toThrow("Detail phase introduced new vehicles");
  });

  it("keeps a mappable card when detail is missing", () => {
    const frozen = [vehicle({ stockId: "keep" })];
    const applied = applyDetailEnrichment(frozen, new Map());
    expect(applied.detailMissing).toBe(0);
    expect(applied.vehicles).toHaveLength(1);
  });

  it("counts unmappable disappeared details as detailMissing", () => {
    const frozen = [vehicle({ stockId: "gone", make: "", model: "", year: null, mileage: null })];
    const applied = applyDetailEnrichment(frozen, new Map());
    expect(applied.detailMissing).toBe(1);
    expect(applied.vehicles).toHaveLength(1);
  });
});

describe("import ocean inventory reconcile", () => {
  it("dedupes the same vehicle from OMV and Ocean Ford and prefers dedicated copy", () => {
    const omv = vehicle({
      sourceKey: "omv",
      description: "Short OMV copy.",
      imageUrls: ["https://cdn.example.com/omv.jpg"],
    });
    const ford = vehicle({
      sourceKey: "ocean-ford",
      description: "Much longer dedicated Ocean Ford description with extra specification.",
      imageUrls: ["https://cdn.example.com/ford.jpg", "https://cdn.example.com/omv.jpg"],
    });
    const reconciled = reconcileVehicles([
      sourceResult({ sourceKey: "omv", vehicles: [omv] }),
      sourceResult({ sourceKey: "ocean-ford", vehicles: [ford] }),
    ]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].sources).toEqual(["omv", "ocean-ford"]);
    expect(reconciled[0].preferredSource).toBe("ocean-ford");
    expect(reconciled[0].vehicle.imageUrls).toEqual([
      "https://cdn.example.com/omv.jpg",
      "https://cdn.example.com/ford.jpg",
    ]);
  });

  it("uses a composite fingerprint when stable IDs are missing", () => {
    const left = vehicle({
      stockId: null,
      registration: null,
      stockReference: null,
      detailUrl: null,
      sourceKey: "omv",
    });
    const right = vehicle({
      stockId: null,
      registration: null,
      stockReference: null,
      detailUrl: null,
      sourceKey: "ocean-ford",
    });
    expect(reconcileVehicles([
      sourceResult({ sourceKey: "omv", vehicles: [left] }),
      sourceResult({ sourceKey: "ocean-ford", vehicles: [right] }),
    ])).toHaveLength(1);
  });

  it("skips identity conflicts and keeps price mismatches", () => {
    const included = vehicle({ sourceKey: "omv", locationName: "Ocean Ford", pricePence: 1_850_000 });
    const excluded = vehicle({
      sourceKey: "ocean-ford",
      locationName: "Keighley Mazda",
      pricePence: 1_900_000,
    });
    const conflict = reconcileVehicles([
      sourceResult({ sourceKey: "omv", vehicles: [included] }),
      sourceResult({ sourceKey: "ocean-ford", vehicles: [excluded] }),
    ]);
    expect(conflict[0]?.identityConflict).toBe(true);

    const mismatch = reconcileVehicles([
      sourceResult({
        sourceKey: "omv",
        vehicles: [vehicle({ sourceKey: "omv", pricePence: 1_850_000 })],
      }),
      sourceResult({
        sourceKey: "ocean-ford",
        vehicles: [vehicle({ sourceKey: "ocean-ford", pricePence: 1_990_000 })],
      }),
    ]);
    expect(mismatch[0]?.priceMismatch).toBe(true);
    expect(mismatch[0]?.identityConflict).toBe(false);
    expect(mapReconciledVehicle(mismatch[0]!).listing?.pricePence).toBe(1_990_000);
  });
});

describe("import ocean inventory pipeline report", () => {
  it("reconciles raw to insert candidates and applies the Pro cap after eligibility", () => {
    const vehicles = Array.from({ length: 3 }, (_, index) =>
      vehicle({
        stockId: `stock-${index}`,
        registration: `MAN${index}`,
        year: 2020 + index,
        mileage: 10_000 + index,
      }),
    );
    const extras = Array.from({ length: 2 }, (_, index) =>
      vehicle({
        sourceKey: "omv",
        stockId: `omv-${index}`,
        registration: `OMV${index}`,
        locationName: "Ocean Citroën",
      }),
    );
    const pipeline = runImportPipeline({
      sourceResults: [
        sourceResult({
          sourceKey: "ocean-ford",
          vehicles: [...vehicles, vehicle({ stockId: "cit", locationName: "Ocean Citroën" })],
          rawCount: 4,
        }),
        sourceResult({
          sourceKey: "omv",
          vehicles: [{ ...vehicles[0], sourceKey: "omv" }, ...extras],
          rawCount: 3,
        }),
        sourceResult({ sourceKey: "transit-centre", vehicles: [] }),
        sourceResult({ sourceKey: "ocean-kia", vehicles: [] }),
      ],
      existingListings: [
        {
          year: "2020",
          make: "Ford",
          model: "Focus",
          mileage: "10000",
          pricePence: 1_850_000,
        },
      ],
      remainingSlots: 1,
      scrapeStartedAt: new Date("2026-08-22T12:00:00.000Z"),
      scrapeFinishedAt: new Date("2026-08-22T12:01:00.000Z"),
    });

    expect(pipeline.report.successfulRawCount).toBe(7);
    expect(pipeline.report.successfulEligibleCount).toBe(4);
    expect(pipeline.report.overlap).toBe(1);
    expect(pipeline.report.dedicatedOnly).toBe(2);
    expect(pipeline.report.omvOnly).toBe(0);
    expect(pipeline.report.uniqueAfterDedupe).toBe(3);
    expect(pipeline.report.alreadyPresent).toBe(1);
    expect(pipeline.report.insertCandidates).toBe(2);
    expect(pipeline.report.wouldInsert).toBe(1);
    expect(pipeline.report.proCapLeftovers).toBe(1);
    expect(pipeline.report.reconciliationErrors).toEqual([]);
    expect(pipeline.canLiveInsert).toBe(true);
    expect(pipeline.selected[0]?.listing?.identity.year).toBe(2022);
  });

  it("blocks live insert when a required source fails and allows OMV-only failure", () => {
    const okFord = sourceResult({
      sourceKey: "ocean-ford",
      vehicles: [vehicle()],
    });
    const failedTransit: SourceListResult = {
      sourceKey: "transit-centre",
      status: "failed",
      error: "ND_COMPONENT_CONTEXT missing",
      startUrl: "https://www.oceanford.com/transit-centre/",
      pagesFetched: 0,
      rawCount: null,
      vehicles: [],
    };
    const failedOmv: SourceListResult = {
      ...failedTransit,
      sourceKey: "omv",
      startUrl: "https://www.oceanmotorvillage.com/search/",
    };
    expect(liveInsertBlockedReason([okFord, failedTransit])).toContain("transit-centre");
    expect(liveInsertBlockedReason([okFord, failedOmv])).toBeNull();
    expect(omvLowerBoundWarning([okFord, failedOmv])).toMatch(/lower bound/);
    expect(failedTransit.rawCount).toBeNull();

    const blocked = runImportPipeline({
      sourceResults: [
        okFord,
        failedTransit,
        sourceResult({ sourceKey: "ocean-kia", vehicles: [] }),
        failedOmv,
      ],
      existingListings: [],
      remainingSlots: 100,
      scrapeStartedAt: new Date(),
      scrapeFinishedAt: new Date(),
    });
    expect(blocked.canLiveInsert).toBe(false);
    expect(blocked.report.failedSources.map((item) => item.key)).toEqual([
      "transit-centre",
      "omv",
    ]);
    expect(formatImportReport(blocked.report)).toContain("LIVE INSERT BLOCKED");

    const allowed = runImportPipeline({
      sourceResults: [
        okFord,
        sourceResult({ sourceKey: "transit-centre", vehicles: [] }),
        sourceResult({ sourceKey: "ocean-kia", vehicles: [] }),
        failedOmv,
      ],
      existingListings: [],
      remainingSlots: 100,
      scrapeStartedAt: new Date(),
      scrapeFinishedAt: new Date(),
    });
    expect(allowed.canLiveInsert).toBe(true);
    expect(allowed.report.lowerBoundWarning).toMatch(/lower bound/);
  });

  it("does not create a second listing on rerun", () => {
    const first = runImportPipeline({
      sourceResults: [sourceResult({ sourceKey: "ocean-ford", vehicles: [vehicle()] })],
      existingListings: [],
      remainingSlots: 100,
      scrapeStartedAt: new Date(),
      scrapeFinishedAt: new Date(),
    });
    const listing = first.selected[0]?.listing;
    expect(listing).toBeTruthy();
    const rerun = runImportPipeline({
      sourceResults: [sourceResult({ sourceKey: "ocean-ford", vehicles: [vehicle()] })],
      existingListings: [
        {
          year: String(listing!.identity.year),
          make: listing!.identity.make,
          model: listing!.identity.model,
          mileage: String(listing!.identity.mileage),
          pricePence: listing!.identity.pricePence,
        },
      ],
      remainingSlots: 99,
      scrapeStartedAt: new Date(),
      scrapeFinishedAt: new Date(),
    });
    expect(rerun.selected).toHaveLength(0);
    expect(rerun.report.alreadyPresent).toBe(1);
    expect(rerun.report.wouldInsert).toBe(0);
  });
});

describe("import ocean inventory target", () => {
  it("refuses production and keeps the Ocean Motor Village import identity", () => {
    expect(IMPORT_DEALER_EMAIL).toBe("mattduff36@gmail.com");
    expect(IMPORT_DEALER_NAME).toBe("Ocean Motor Village");
    expect(EXPECTED_PRO_CAP).toBe(100);
    expect(() =>
      assertPreviewImportTarget({
        databaseUrl: "postgresql://postgres:x@db.snlqivvogfqesxpbjiei.supabase.co:5432/postgres",
        supabaseUrl: "https://syneonzucehwlghqmfbg.supabase.co",
      }),
    ).toThrow("not the new-ford-dealership preview");
  });
});

describe("import ocean inventory normalize", () => {
  it("reads a NetDirector card payload", () => {
    const normalized = normalizeNetDirectorVehicle(
      {
        id: "1742",
        manufacturer: "Kia",
        model: "Sportage",
        variant: "GT-Line",
        productionYear: 2024,
        odometer: { value: 8000 },
        price: { current: 28995, isPoa: false },
        location: { name: "Ocean KIA" },
        type: "Car",
        mainImage: "//cdn.example.com/kia.jpg",
        fuel: { typeEnglish: "Petrol" },
        transmission: { type: "Automatic" },
        colour: { exteriorGenericEnglish: "White" },
      },
      "ocean-kia",
    );
    expect(normalized?.make).toBe("Kia");
    expect(normalized?.pricePence).toBe(2_899_500);
    expect(normalized?.imageUrls).toEqual(["https://cdn.example.com/kia.jpg"]);
    expect(normalized?.locationName).toBe("Ocean KIA");
  });

  it("reads a classic stock-listing card and GraphQL wrappers", () => {
    const classic = normalizeNetDirectorVehicle(
      {
        id: "21407318",
        url: "/used-cars/21407318-vauxhall-corsa/",
        location_name: "Ocean Ford",
        registration: "TMN431B",
        stock_number: "21407318",
        year: "2022",
        make: "Vauxhall",
        model: "Corsa",
        variant: "1.2 Turbo Design 5dr",
        mileage: "37,140 miles",
        engine_size: "1.2 l",
        fuel: "Petrol",
        transmission: "Manual",
        colour: "Red",
        doors: 5,
        price_now_raw: 11245,
        image: "//cdn.example.com/corsa.jpg",
        bodystyle: "Hatchback",
      },
      "ocean-ford",
      "https://www.oceanford.com",
    );
    expect(classic?.pricePence).toBe(1_124_500);
    expect(classic?.mileage).toBe(37140);
    expect(classic?.locationName).toBe("Ocean Ford");
    expect(classic?.detailUrl).toBe("https://www.oceanford.com/used-cars/21407318-vauxhall-corsa/");
    const brandNew = normalizeNetDirectorVehicle(
      {
        id: "21255274",
        make: "Ford",
        model: "Puma",
        registration: "NEW7045",
        mileage: "7 miles",
        price_now_raw: 31014,
        location_name: "Ocean Ford",
        year: "",
        snowplow_vehicle_context: JSON.stringify({ ve_is_new: true, ve_mi: 7 }),
      },
      "ocean-ford",
    );
    expect(brandNew?.year).toBe(new Date().getFullYear());
    expect(brandNew?.mileage).toBe(7);
    expect(extractSearchVehicles({ data: { getCount: 148, allVehicles: [{ id: "1" }] } })).toHaveLength(
      1,
    );
    expect(extractTotalPages({ data: { getCount: 148, allVehicles: Array(12).fill({}) } }, 12)).toBe(
      13,
    );
    expect(extractTotalPages({ count: 37, perPage: 24, vehicles: [] }, 24)).toBe(2);
    const gallery = extractGalleryFromHtml(`
      <img src="https://images.netdirector.auto/${Buffer.from(JSON.stringify({ key: "ndstock/a.jpg", edits: { resize: { width: 400 } } })).toString("base64")}" />
      <img src="https://images.netdirector.auto/${Buffer.from(JSON.stringify({ key: "ndstock/a.jpg", edits: { resize: { width: 800 } } })).toString("base64")}" />
      <img src="//s3-eu-west-1.amazonaws.com/nd-stock/photo_1.jpg" />
    `);
    expect(gallery).toHaveLength(2);
  });
});
