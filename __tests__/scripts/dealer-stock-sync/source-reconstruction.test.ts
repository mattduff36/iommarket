import { describe, expect, it } from "vitest";
import { pipelineResultFromSources } from "../../../scripts/dealer-stock-sync/pipeline";
import type { CanonicalVehicle, DealerRecord } from "../../../scripts/dealer-stock-sync/types";
import { dealerFixture, sourceResult, vehicle } from "./fixtures";

const SCRAPED_AT = "2026-10-16T22:57:41.601Z";

function oceanDealer(): DealerRecord {
  return dealerFixture({
    key: "ocean-motor-village",
    displayName: "Ocean Motor Village",
    locations: ["Ocean Ford", "Ocean Ford - Transit Centre", "Ocean KIA"],
  });
}

function stock(id: string, locationName: string, sourceKey: string): CanonicalVehicle {
  return vehicle({
    dealerKey: "ocean-motor-village",
    sourceKey,
    sourceVehicleId: id,
    registration: null,
    vin: null,
    locationName,
    imageUrls: [`https://cdn.example.com/${id}.jpg`],
    scrapedAt: SCRAPED_AT,
  });
}

function ranged(prefix: string, count: number, locationName: string, sourceKey: string) {
  return Array.from({ length: count }, (_, index) => stock(`${prefix}-${index}`, locationName, sourceKey));
}

describe("raw source reconstruction", () => {
  it("preserves original photo URLs and scrape timestamps", () => {
    const sourceVehicle = stock("ford-photo", "Ocean Ford", "ocean-ford");
    const sources = [sourceResult({ dealerKey: "ocean-motor-village", sourceKey: "ocean-ford", vehicles: [sourceVehicle] })];
    const result = pipelineResultFromSources({
      dealer: oceanDealer(),
      sourceResults: sources,
      scrapeStartedAt: "2026-10-16T22:57:33.190Z",
      scrapeFinishedAt: "2026-10-16T22:58:10.000Z",
    });

    sourceVehicle.imageUrls.splice(0, sourceVehicle.imageUrls.length);
    expect(result.scrapeStartedAt).toBe("2026-10-16T22:57:33.190Z");
    expect(result.scrapeFinishedAt).toBe("2026-10-16T22:58:10.000Z");
    expect(result.sourceResults[0]?.vehicles[0]?.imageUrls).toEqual(["https://cdn.example.com/ford-photo.jpg"]);
    expect(result.sourceResults[0]?.vehicles[0]?.scrapedAt).toBe(SCRAPED_AT);
    expect(result.reconciled[0]?.vehicle.imageUrls).toEqual(["https://cdn.example.com/ford-photo.jpg"]);
    expect(result.reconciled[0]?.vehicle.scrapedAt).toBe(SCRAPED_AT);
    expect(result.canArchive).toBe(true);
  });

  it("keeps only deduped eligible Ocean locations and excludes off-island and 4Hire stock", () => {
    const ford = ranged("ford", 22, "Ocean Ford", "omv");
    const kia = ranged("kia", 15, "Ocean KIA", "omv");
    const transit = ranged("transit", 11, "Ocean Ford - Transit Centre", "omv");
    const sources = [
      sourceResult({
        dealerKey: "ocean-motor-village",
        sourceKey: "omv",
        vehicles: [
          ...ford,
          ...kia,
          ...transit,
          ...ranged("keighley", 72, "Bentley Motor Group - Keighley", "omv"),
          ...ranged("mazda", 8, "Keighley Mazda", "omv"),
          ...ranged("bnb", 8, "BnB Motorhomes", "omv"),
          stock("hire-1", "4Hire", "omv"),
        ],
      }),
      sourceResult({
        dealerKey: "ocean-motor-village",
        sourceKey: "ocean-ford",
        vehicles: ford.map((item) => stock(item.sourceVehicleId ?? "", "Ocean Ford", "ocean-ford")),
      }),
      sourceResult({
        dealerKey: "ocean-motor-village",
        sourceKey: "ocean-kia",
        vehicles: [
          ...ford.map((item) => stock(item.sourceVehicleId ?? "", "Ocean Ford", "ocean-kia")),
          ...kia.map((item) => stock(item.sourceVehicleId ?? "", "Ocean KIA", "ocean-kia")),
          ...ranged("mazda", 8, "Keighley Mazda", "ocean-kia"),
        ],
      }),
      sourceResult({
        dealerKey: "ocean-motor-village",
        sourceKey: "transit-centre",
        vehicles: transit.map((item) =>
          stock(item.sourceVehicleId ?? "", "Ocean Ford - Transit Centre", "transit-centre"),
        ),
      }),
      sourceResult({
        dealerKey: "ocean-motor-village",
        sourceKey: "ocean-citroen",
        vehicles: [stock("citroen-1", "Ocean Citroën", "ocean-citroen")],
      }),
    ];

    const result = pipelineResultFromSources({
      dealer: oceanDealer(),
      sourceResults: sources,
      scrapeStartedAt: SCRAPED_AT,
      scrapeFinishedAt: SCRAPED_AT,
    });

    expect(result.canArchive).toBe(true);
    expect(result.sourceResults.every((source) => source.status === "ok")).toBe(true);
    expect(result.reconciled).toHaveLength(48);
    expect(new Set(result.reconciled.map((item) => item.vehicle.locationName))).toEqual(
      new Set(["Ocean Ford", "Ocean KIA", "Ocean Ford - Transit Centre"]),
    );
    expect(result.reconciled.some((item) => item.vehicle.sourceVehicleId?.startsWith("bnb"))).toBe(false);
    expect(result.reconciled.some((item) => item.vehicle.imageUrls.length === 0)).toBe(false);
  });

  it("fails closed for unknown or ambiguous Ocean locations without changing other dealers", () => {
    const unknown = pipelineResultFromSources({
      dealer: oceanDealer(),
      sourceResults: [
        sourceResult({
          dealerKey: "ocean-motor-village",
          sourceKey: "omv",
          vehicles: [stock("ford-1", "Ocean Ford", "omv"), stock("other-1", "Some Other Yard", "omv")],
        }),
      ],
      scrapeStartedAt: SCRAPED_AT,
      scrapeFinishedAt: SCRAPED_AT,
    });
    expect(unknown.canArchive).toBe(false);
    expect(unknown.sourceResults[0]?.status).toBe("failed");
    expect(unknown.sourceResults[0]?.error).toContain("unknown-ocean-location:Some Other Yard");
    expect(unknown.sourceResults[0]?.vehicles.map((item) => item.imageUrls[0])).toEqual([
      "https://cdn.example.com/ford-1.jpg",
      "https://cdn.example.com/other-1.jpg",
    ]);
    expect(unknown.reconciled.map((item) => item.vehicle.sourceVehicleId)).toEqual(["ford-1"]);

    const ambiguous = pipelineResultFromSources({
      dealer: oceanDealer(),
      sourceResults: [
        sourceResult({
          dealerKey: "ocean-motor-village",
          sourceKey: "omv",
          vehicles: [stock("shared-1", "Ocean Ford", "omv"), stock("shared-1", "Keighley Mazda", "omv")],
        }),
      ],
      scrapeStartedAt: SCRAPED_AT,
      scrapeFinishedAt: SCRAPED_AT,
    });
    expect(ambiguous.canArchive).toBe(false);
    expect(ambiguous.sourceResults[0]?.error).toContain("ambiguous-ocean-location:");
    expect(ambiguous.reconciled).toHaveLength(0);

    const otherDealer = vehicle({
      dealerKey: "athol-garage",
      sourceKey: "used-cars",
      locationName: "Some Other Yard",
      imageUrls: ["https://cdn.example.com/athol.jpg"],
    });
    const preserved = pipelineResultFromSources({
      dealer: dealerFixture(),
      sourceResults: [sourceResult({ dealerKey: "athol-garage", sourceKey: "used-cars", vehicles: [otherDealer] })],
      scrapeStartedAt: SCRAPED_AT,
      scrapeFinishedAt: SCRAPED_AT,
    });
    expect(preserved.canArchive).toBe(true);
    expect(preserved.sourceResults[0]?.status).toBe("ok");
    expect(preserved.reconciled).toHaveLength(1);
    expect(preserved.reconciled[0]?.vehicle.imageUrls).toEqual(["https://cdn.example.com/athol.jpg"]);
  });

});

