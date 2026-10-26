import { describe, expect, it } from "vitest";
import { DesktopSubmissionError, parseDesktopScrapeSubmission } from "@/lib/dealer-stock-sync/desktop-inventory";

const CARS = "https://www.mikesmotors.im/used-cars";
const VANS = "https://www.mikesmotors.im/used-vans";
const BIKES = "https://www.mikesmotors.im/used-bikes";
const CDN = "https://images.clickdealer.co.uk/vehicles/8324/8324646/full/204251334.jpg";

function times() {
  const scrapeStartedAt = new Date().toISOString();
  const scrapeFinishedAt = new Date(Date.now() + 1000).toISOString();
  return { scrapeStartedAt, scrapeFinishedAt };
}

function vehicle(stamp: string, overrides: Record<string, unknown> = {}) {
  return {
    dealerKey: "mikes-motors",
    sourceKey: "used-cars",
    platform: "click-dealer",
    sourceVehicleId: "8324646",
    registration: "MNZ123A",
    vin: null,
    stockReference: null,
    make: "Ford",
    model: "Fiesta",
    derivative: null,
    year: 2019,
    firstRegistrationDate: null,
    mileage: 32000,
    pricePence: 899500,
    isPoa: false,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: "Blue",
    doors: 5,
    seats: 5,
    engineSize: 1.2,
    enginePower: 100,
    vehicleType: "car",
    description: "One owner.",
    locationName: null,
    detailUrl: `${CARS}/ford-fiesta-8324646`,
    imageUrls: [CDN],
    availability: "available",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: stamp,
    provenance: { startUrl: CARS, sourceKeys: ["used-cars"], rawIdentityHints: ["8324646"] },
    ...overrides,
  };
}

function source(
  key: string,
  startUrl: string,
  vehicles: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    dealerKey: "mikes-motors",
    sourceKey: key,
    platform: "click-dealer",
    status: "ok",
    error: null,
    startUrl,
    pagesFetched: 1,
    advertisedCount: vehicles.length,
    rawCount: vehicles.length,
    vehicles,
    detailMissing: 0,
    paginationUncertain: false,
    ...overrides,
  };
}

function submission(overrides: Record<string, unknown> = {}) {
  const window = times();
  const cars = source("used-cars", CARS, [vehicle(window.scrapeStartedAt)]);
  const vans = source("used-vans", VANS, []);
  const bikes = source("used-bikes", BIKES, []);
  return { sourceResults: [bikes, vans, cars], ...window, ...overrides };
}

describe("parseDesktopScrapeSubmission", () => {
  it("accepts engine size in source cc units without changing its value", () => {
    const body = submission();
    const cars = (body.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
    (cars!.vehicles as Array<Record<string, unknown>>)[0] = vehicle(body.scrapeStartedAt, { engineSize: 1998 });
    expect(parseDesktopScrapeSubmission("mikes-motors", body).sourceResults[0]?.vehicles[0]?.engineSize).toBe(1998);
  });

  it("rejects invalid calendar dates rather than allowing NaN window comparisons", () => {
    for (const patch of [
      { scrapedAt: "2026-99-99T12:00:00.000Z" },
      { sourceCreatedAt: "2026-02-31T12:00:00.000Z" },
      { firstRegistrationDate: "2026-02-31" },
    ]) {
      const body = submission();
      const cars = (body.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
      (cars!.vehicles as Array<Record<string, unknown>>)[0] = vehicle(body.scrapeStartedAt, patch);
      expect(() => parseDesktopScrapeSubmission("mikes-motors", body)).toThrow(DesktopSubmissionError);
    }
  });

  it("reconstructs Mike's Motors from the registry and the Click Dealer CDN", () => {
    const result = parseDesktopScrapeSubmission("mikes-motors", submission());

    expect(result.dealer.displayName).toBe("Mike's Motors");
    expect(result.dealer.sources.map((item) => item.key)).toEqual(["used-cars", "used-vans", "used-bikes"]);
    expect(result.sourceResults.map((item) => item.sourceKey)).toEqual(["used-cars", "used-vans", "used-bikes"]);
    expect(result.sourceResults[0]?.vehicles[0]?.imageUrls).toEqual([CDN]);
    expect(result.sourceResults[0]?.vehicles[0]?.detailUrl).toBe(`${CARS}/ford-fiesta-8324646`);
    expect(result.reconciled).toHaveLength(1);
    expect(result.reconciled[0]?.identityKey).toBe("sourceVehicleId:8324646");
    expect(result.canArchive).toBe(true);
    expect(result.sourceResults[0]).not.toHaveProperty("rawRecords");
  });

  it("rejects a photo host outside the source host and reviewed CDN", () => {
    const body = submission();
    const cars = (body.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
    const listed = cars?.vehicles as Array<Record<string, unknown>>;
    listed[0] = vehicle(body.scrapeStartedAt, { imageUrls: ["https://cdn.example/ford.jpg"] });

    expect(() => parseDesktopScrapeSubmission("mikes-motors", body)).toThrow(DesktopSubmissionError);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", body)).toThrow(/public HTTPS/);
  });

  it("rejects duplicate and missing sources", () => {
    const body = submission();
    const [bikes, vans, cars] = body.sourceResults as unknown[];
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, sourceResults: [cars, cars, vans, bikes] })).toThrow(
      /Duplicate source used-cars/,
    );
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, sourceResults: [cars, vans] })).toThrow(
      /Missing source used-bikes/,
    );
  });

  it("rejects numeric, type, and size injection", () => {
    const body = submission();
    const replace = (overrides: Record<string, unknown>) => {
      const next = submission();
      const cars = (next.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
      const listed = cars?.vehicles as Array<Record<string, unknown>>;
      listed[0] = vehicle(next.scrapeStartedAt, overrides);
      return next;
    };

    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({ mileage: "32000" }))).toThrow(/Invalid desktop submission/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({ mileage: -1 }))).toThrow(/Invalid desktop submission/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({ pricePence: Number.POSITIVE_INFINITY }))).toThrow(
      /Invalid desktop submission/,
    );
    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({ isPoa: "false" }))).toThrow(/Invalid desktop submission/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, sourceResults: { used: true } })).toThrow(
      /Invalid desktop submission/,
    );
    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({
      imageUrls: Array.from({ length: 21 }, (_, index) => `${CDN}?n=${index}`),
    }))).toThrow(/Invalid desktop submission/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", replace({ description: "x".repeat(4001) }))).toThrow(
      /Invalid desktop submission/,
    );
    expect(() => parseDesktopScrapeSubmission("mikes-motors", "x".repeat(2_100_000))).toThrow(/2MiB/);
  });

  it("does not treat omitted pagination or detail flags as a complete scrape", () => {
    const body = submission();
    for (const source of body.sourceResults as Array<Record<string, unknown>>) {
      delete source.detailMissing;
      delete source.paginationUncertain;
    }
    const result = parseDesktopScrapeSubmission("mikes-motors", body);

    expect(result.canArchive).toBe(false);
    expect(result.sourceResults.every((source) => source.detailMissing === 1 && source.paginationUncertain === true)).toBe(true);
    expect(result.reconciled).toHaveLength(1);
  });

  it("keeps failed and partial sources out of the archive gate", () => {
    const failed = submission();
    const vans = (failed.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-vans");
    Object.assign(vans ?? {}, { status: "failed", error: "timeout", advertisedCount: null, rawCount: null });
    expect(parseDesktopScrapeSubmission("mikes-motors", failed).canArchive).toBe(false);

    const partial = submission();
    const cars = (partial.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
    Object.assign(cars ?? {}, { advertisedCount: 5 });
    expect(parseDesktopScrapeSubmission("mikes-motors", partial).canArchive).toBe(false);

    const smuggled = submission();
    const bikeSource = (smuggled.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-bikes");
    Object.assign(bikeSource ?? {}, {
      status: "failed",
      error: "blocked",
      vehicles: [vehicle(smuggled.scrapeStartedAt, { sourceKey: "used-bikes", sourceVehicleId: "hidden" })],
      advertisedCount: null,
      rawCount: null,
    });
    expect(() => parseDesktopScrapeSubmission("mikes-motors", smuggled)).toThrow(/cannot include vehicles/);
  });

  it("rejects injected plan, reconciliation, fingerprint, approval, and raw records", () => {
    const body = submission();
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, reconciled: [] })).toThrow(/reconciled/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, approval: true })).toThrow(/approval/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, fingerprint: "abc" })).toThrow(/fingerprint/);
    expect(() => parseDesktopScrapeSubmission("mikes-motors", { ...body, plan: { actions: [] } })).toThrow(/plan/);

    const withRaw = submission();
    const cars = (withRaw.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars");
    Object.assign(cars ?? {}, { rawRecords: [{ localPath: "C:\\stock\\a.json" }] });
    expect(() => parseDesktopScrapeSubmission("mikes-motors", withRaw)).toThrow(/rawRecords/);

    const withApproval = submission();
    const listed = ((withApproval.sourceResults as Array<Record<string, unknown>>).find((item) => item.sourceKey === "used-cars")
      ?.vehicles ?? []) as Array<Record<string, unknown>>;
    listed[0] = vehicle(withApproval.scrapeStartedAt, { approval: true });
    expect(() => parseDesktopScrapeSubmission("mikes-motors", withApproval)).toThrow(/approval/);
  });
});
