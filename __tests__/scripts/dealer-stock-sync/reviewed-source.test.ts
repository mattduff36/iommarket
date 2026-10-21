import { describe, expect, it } from "vitest";
import { fingerprintSnapshot } from "../../../lib/dealer-stock-sync/fingerprint";
import type { PlanAction } from "../../../lib/dealer-stock-sync/types";
import {
  adaptReviewedSource,
  assertExpectedSha256,
  digestSha256,
  explicitStockCategory,
  reviewedIdentityKey,
  withReviewEvidence,
} from "../../../scripts/dealer-stock-sync/reviewed-source";
import { vehicle } from "./fixtures";

function row(overrides: Record<string, unknown> = {}) {
  return {
    sourceVehicleId: "stock-1",
    title: "2022 Ford Focus ST-Line",
    sourceUrl: "https://dealer.example/stock-1",
    pricePence: 1_850_000,
    year: 2022,
    mileage: 12000,
    fuel: "Petrol",
    transmission: "Manual",
    description: "A well specified Ford Focus with service history.",
    imageUrls: ["https://dealer.example/safe.jpg"],
    availability: "available" as const,
    flags: [] as string[],
    ...overrides,
  };
}

function reviewed(rows: ReturnType<typeof row>[]) {
  return {
    capturedAt: "2026-10-21T00:00:00.000Z",
    coverage: [{ page: 1, cards: rows.length, next: false }],
    rows,
  };
}

function archived(overrides: Parameters<typeof vehicle>[0] = {}) {
  return { identityKind: "sourceVehicleId", vehicle: vehicle({ imageUrls: ["https://scrape.example/raw.jpg"], ...overrides }) };
}

function adapt(registryKey: string, rows: ReturnType<typeof row>[], archive: ReturnType<typeof archived>[]) {
  return adaptReviewedSource({ registryKey, reviewed: reviewed(rows), archive, sourceHash: "a".repeat(64) });
}

describe("reviewed stock source", () => {
  it("rejects duplicate identities and classifies hyphenated Hi-Lux pickups", () => {
    expect(() => adapt("skillannaylor-car-company", [row(), row()], [archived()])).toThrow(/duplicate vehicle identities/);
    expect(explicitStockCategory("skillannaylor-car-company", "Toyota Hi-Lux Double Cab", 2020)).toBe("van");
  });
  it("rejects a tampered file hash and keeps reviewed price, photos, and flags", () => {
    const bytes = Buffer.from("{\"rows\":[]}");
    expect(() => assertExpectedSha256(bytes, "b".repeat(64))).toThrow(/hash/i);
    expect(digestSha256(bytes)).toHaveLength(64);
    const result = adapt("skillannaylor-car-company", [row({ pricePence: 1_111_100, priceCorrected: true, flags: ["title-fuel-conflict"] })], [archived({ pricePence: 2_222_200 })]);
    expect(result.counts.correctedPrices).toBe(1);
    expect(result.vehicles[0]?.pricePence).toBe(1_111_100);
    expect(result.vehicles[0]?.importable).toBe(false);
    expect(result.vehicles[0]?.skipReason).toBe("review-flag");
    expect(result.vehicles[0]?.sourceImageUrls).toEqual(["https://dealer.example/safe.jpg"]);
  });

  it("excludes sold rows and blocks the two source conflicts without rewriting titles", () => {
    const mercedesId = "2021-mercedes-c220d-amg-line-estate-9g-tronic-auto";
    const dodgeId = "2011-dodge-charger-6-1l-v8-srt-coupe-lhd";
    const result = adapt("skillannaylor-car-company", [
      row({ sourceVehicleId: "sold-1", availability: "sold", flags: ["sold-exclude-from-live-import"], title: "2022 Ford Focus ST-Line" }),
      row({
        sourceVehicleId: mercedesId,
        year: 2021,
        title: "2021 Mercedes C200d AMG Line Estate 9G-Tronic Auto",
        pricePence: 1_649_500,
        priceCorrected: true,
      }),
      row({
        sourceVehicleId: dodgeId,
        year: 2011,
        title: "2011 Dodge Challenger 6.1L V8 SRT Coupe LHD",
      }),
    ], [
      archived({ sourceVehicleId: "sold-1" }),
      archived({
        sourceVehicleId: mercedesId,
        year: 2021,
        make: "Mercedes",
        model: "C200d AMG Line Estate 9G-Tronic Auto",
        derivative: null,
        pricePence: 1_999_500,
      }),
      archived({
        sourceVehicleId: dodgeId,
        year: 2011,
        make: "Dodge",
        model: "Challenger 6.1L V8 SRT Coupe LHD",
        derivative: null,
      }),
    ]);
    expect(result.counts.sold).toBe(1);
    expect(result.vehicles.map((item) => item.skipReason)).toEqual([
      "sold-exclude-from-live-import",
      "source-conflict",
      "source-conflict",
    ]);
    expect(result.vehicles[1]?.pricePence).toBe(1_649_500);
    expect(result.vehicles[1]?.title).toContain("C200d");
    expect(result.vehicles[2]?.title).toContain("Challenger");
    expect(result.vehicles.every((item) => item.importable === false)).toBe(true);
  });

  it("joins Skillan Naylor by source id and DW by title plus year, blocking gaps", () => {
    const sn = adapt("skillannaylor-car-company", [row({ sourceVehicleId: "stock-honda", year: 2000, title: "2000 Honda VTR 1000 SP1" })], [
      archived({ sourceVehicleId: "stock-ford", make: "Ford" }),
      archived({ sourceVehicleId: "stock-honda", year: 2000, make: "Honda", model: "VTR 1000 SP1", derivative: null }),
    ]);
    expect(sn.vehicles[0]?.attributes?.make).toBe("Honda");
    const dw = adapt("dw-cars", [row({ sourceVehicleId: "wrong-id", title: "Ford Focus ST-Line" })], [
      archived({ sourceVehicleId: "wrong-id", year: 2019, make: "Kia", model: "Rio", derivative: null }),
      archived({ sourceVehicleId: "right-id" }),
    ]);
    expect(dw.vehicles[0]?.attributes?.make).toBe("Ford");
    const missing = adapt("dw-cars", [row({ title: "Ford Focus ST-Line", year: 2022 })], [archived({ year: 1999 })]);
    expect(missing.vehicles[0]?.skipReason).toBe("unmatched-archive");
    const ambiguous = adapt("dw-cars", [row({ title: "Ford Focus ST-Line" })], [archived({ sourceVehicleId: "a" }), archived({ sourceVehicleId: "b" })]);
    expect(ambiguous.vehicles[0]?.skipReason).toBe("ambiguous-archive");
  });

  it("uses the inspected categories and keeps a contradictory title", () => {
    expect(explicitStockCategory("skillannaylor-car-company", "2024 Volkswagen Transporter Campervan", 2024)).toBe("motorhome");
    expect(explicitStockCategory("skillannaylor-car-company", "2020 Volkswagen Crafter Camper", 2020)).toBe("motorhome");
    expect(explicitStockCategory("skillannaylor-car-company", "2000 Honda VTR 1000", 2000)).toBe("motorbike");
    expect(explicitStockCategory("skillannaylor-car-company", "2019 Volkswagen T6", 2019)).toBe("van");
    expect(explicitStockCategory("skillannaylor-car-company", "Toyota Hilux Pick-Up", 2018)).toBe("van");
    expect(explicitStockCategory("skillannaylor-car-company", "Nissan Navara Pick-Up", 2019)).toBe("van");
    expect(explicitStockCategory("skillannaylor-car-company", "2022 Ford Focus ST-Line", 2022)).toBe("car");
    expect(explicitStockCategory("dw-cars", "Toyota Hilux Pick-Up", 2018)).toBe("car");
    const conflict = adapt("skillannaylor-car-company", [row({ title: "Completely different vehicle" })], [archived()]);
    expect(conflict.vehicles[0]?.skipReason).toBe("title-conflict");
    expect(conflict.vehicles[0]?.title).toBe("Completely different vehicle");
    const camper = adapt("skillannaylor-car-company", [row({
      year: 2024,
      title: "2024 Volkswagen Transporter Campervan",
    })], [archived({ year: 2024, make: "Volkswagen", model: "Transporter Campervan", derivative: null })]);
    expect(camper.vehicles[0]?.categorySlug).toBe("motorhome");
    expect(camper.vehicles[0]?.importable).toBe(true);
  });

  it("includes review evidence in the plan fingerprint", () => {
    const result = adapt("skillannaylor-car-company", [row()], [archived()]);
    const key = reviewedIdentityKey("stock-1");
    const blocked: PlanAction = { kind: "blocked", sourceIdentityKey: key, listingId: null, reason: "review-flag", section: "new" };
    const actions = withReviewEvidence([blocked], result.evidence, "cap warning");
    const tampered = withReviewEvidence([blocked], {
      [key]: { ...result.evidence[key]!, pricePence: 1 },
    }, "cap warning");
    const snapshot = {
      dealer: { id: "d", userId: "u", regionId: "r", tier: "STARTER", isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
      binding: { id: "b", registryKey: "skillannaylor-car-company", enabled: false, verifiedAt: null },
      activeListingCount: 0,
      listingCap: 30,
      listings: [],
      identities: [],
      actions,
    };
    expect(actions[0]?.review?.safePhotoUrls).toEqual(["https://dealer.example/safe.jpg"]);
    expect(fingerprintSnapshot(snapshot)).not.toBe(fingerprintSnapshot({ ...snapshot, actions: tampered }));
  });
});
