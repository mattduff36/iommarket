import { describe, expect, it } from "vitest";
import { withReviewEvidence } from "@/scripts/dealer-stock-sync/reviewed-source";
import { liveReviewEvidence } from "@/scripts/dealer-stock-sync/live-review-evidence";
import { identityFor } from "@/scripts/dealer-stock-sync/identity";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import type { CanonicalVehicle, ReconciledVehicle } from "@/scripts/dealer-stock-sync/types";

function canonical(overrides: Partial<CanonicalVehicle> = {}): CanonicalVehicle {
  return {
    dealerKey: "sample-motors",
    sourceKey: "used",
    platform: "unknown",
    sourceVehicleId: "AbC 1",
    registration: null,
    vin: null,
    stockReference: null,
    make: "Ford",
    model: "Focus",
    derivative: "ST-Line",
    year: 2020,
    firstRegistrationDate: null,
    mileage: 15000,
    pricePence: 999_500,
    isPoa: false,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
    colour: null,
    doors: null,
    seats: null,
    engineSize: null,
    enginePower: null,
    vehicleType: "Car",
    description: "A listed Ford Focus.",
    locationName: null,
    detailUrl: "https://dealer.example/used/focus",
    imageUrls: [
      "https://cdn.example/focus.jpg",
      "http://cdn.example/insecure.jpg",
      "https://user:secret@cdn.example/private.jpg",
      "https://cdn.example/focus.jpg",
      "not-a-url",
    ],
    availability: "available",
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    scrapedAt: "2026-10-22T18:00:00.000Z",
    provenance: { startUrl: "https://dealer.example/used", sourceKeys: ["used"], rawIdentityHints: ["AbC 1"] },
    ...overrides,
  };
}

function reconciled(vehicle: CanonicalVehicle): ReconciledVehicle {
  const identity = identityFor(vehicle);
  return {
    identityKey: identity?.key ?? "none",
    identityKind: identity?.kind ?? "composite",
    sources: vehicle.provenance.sourceKeys,
    preferredSource: vehicle.sourceKey,
    vehicle,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "test",
  };
}

describe("live review evidence", () => {
  it("maps specs and safe photos onto create, update, and blocked actions", () => {
    const capturedAt = "2026-10-22T18:00:00.000Z";
    const available = canonical();
    const sold = canonical({
      sourceVehicleId: "sold-9",
      availability: "sold",
      pricePence: 100,
      year: 2018,
      mileage: 40000,
      fuel: "Diesel",
      transmission: "Automatic",
      detailUrl: "https://dealer.example/used/sold",
      imageUrls: ["https://cdn.example/sold.jpg"],
    });
    const composite = canonical({
      sourceVehicleId: null,
      vin: null,
      registration: null,
      stockReference: null,
      detailUrl: null,
      make: "Audi",
      model: "A4",
      year: 2019,
    });
    const evidence = liveReviewEvidence({
      reconciled: [reconciled(available), reconciled(sold), reconciled(composite)],
      capturedAt,
    });
    const again = liveReviewEvidence({
      reconciled: [reconciled(available), reconciled(sold)],
      capturedAt: "2026-10-23T18:00:00.000Z",
    });
    const changed = liveReviewEvidence({
      reconciled: [reconciled(canonical({ pricePence: 100 }))],
      capturedAt,
    });

    expect(evidence["sourceVehicleId:abc1"]).toMatchObject({
      displayTitle: "2020 Ford Focus ST-Line",
      pricePence: 999_500,
      year: 2020,
      mileage: 15000,
      fuel: "Petrol",
      transmission: "Manual",
      sourceUrl: "https://dealer.example/used/focus",
      safePhotoUrls: ["https://cdn.example/focus.jpg"],
      availability: "available",
      provenance: ["used"],
      capturedAt,
      categorySlug: "car",
      flags: [],
      coverageWarning: null,
    });
    expect(evidence["sourceVehicleId:sold-9"]).toMatchObject({
      availability: "sold",
      flags: ["sold-exclude-from-live-import"],
      safePhotoUrls: ["https://cdn.example/sold.jpg"],
      capturedAt,
    });
    expect(Object.keys(evidence).some((key) => key.startsWith("composite:"))).toBe(false);
    expect(evidence["sourceVehicleId:abc1"]?.sourceHash).toBe(again["sourceVehicleId:abc1"]?.sourceHash);
    expect(changed["sourceVehicleId:abc1"]?.sourceHash).not.toBe(evidence["sourceVehicleId:abc1"]?.sourceHash);
    expect(Number.isNaN(Date.parse(evidence["sourceVehicleId:abc1"]?.capturedAt ?? ""))).toBe(false);

    const key = "sourceVehicleId:abc1";
    const actions: PlanAction[] = [
      {
        kind: "create",
        sourceIdentityKey: key,
        listingId: null,
        title: "2020 Ford Focus ST-Line",
        description: "A listed Ford Focus.",
        pricePence: 999_500,
        categorySlug: "car",
        attributes: {},
        ownedImages: [],
        changes: [],
      },
      {
        kind: "update",
        sourceIdentityKey: "sourceVehicleId:sold-9",
        listingId: "listing-9",
        changes: [],
        lifecycleRevision: 1,
        photoRevision: 1,
        featured: false,
      },
      { kind: "blocked", sourceIdentityKey: key, listingId: null, reason: "source-sold", section: "new" },
      { kind: "missing_once", sourceIdentityKey: "sourceVehicleId:gone", listingId: null, absenceCount: 1 },
    ];
    const reviewed = withReviewEvidence(actions, evidence, null);
    expect(reviewed[0]?.review?.safePhotoUrls).toEqual(["https://cdn.example/focus.jpg"]);
    expect(reviewed[0]?.review?.capturedAt).toBe(capturedAt);
    expect(reviewed[1]?.review).toMatchObject({ fuel: "Diesel", transmission: "Automatic", year: 2018, mileage: 40000 });
    expect(reviewed[2]?.review?.safePhotoUrls).toEqual(["https://cdn.example/focus.jpg"]);
    expect(reviewed[3]?.review).toBeUndefined();
    expect(liveReviewEvidence({ reconciled: [reconciled(available)], capturedAt: "not-a-date" })).toEqual({});
  });
});
