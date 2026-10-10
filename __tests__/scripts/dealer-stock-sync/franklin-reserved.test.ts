import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { foundingManagedSlug, oceanManagedSlug } from "../../../lib/dealer-stock-sync/legacy-identity";
import { extractFranklinsListBoxes } from "../../../scripts/dealer-stock-sync/connectors/named-html-more";
import { mapReconciledVehicle } from "../../../scripts/dealer-stock-sync/map-listing";
import type { ReconciledVehicle } from "../../../scripts/dealer-stock-sync/types";
import { foundingListingSlug } from "../../../scripts/onboard-founding-dealers/identity";

describe("Franklins reserved inventory", () => {
  it("keeps a reserved card in the inventory without treating it as POA", () => {
    const cards = extractFranklinsListBoxes(
      `<div class="list-box-wrapper grid-view">
        <div class="view-car-details"><h2><strong>FORD</strong> FOCUS</h2><h3>Zetec (2018)</h3></div>
        <div>RESERVED</div>
        <a class="view-car-details" href="https://www.franklins.co.im/cars/ford/focus/zetec/1591091/">VIEW</a>
      </div>`,
      "https://www.franklins.co.im",
    );
    expect(cards[0]).toMatchObject({
      sourceVehicleId: "1591091",
      vehicleType: "car",
      availability: "reserved",
      isPoa: false,
      price: null,
    });
  });

  it("keeps the van id and type from the representative stock cards", () => {
    const html = `<div class="list-box-wrapper"><h2><strong>RENAULT</strong> KANGOO MAXI</h2><h3>Van (2023)</h3><a class="view-car-details" href="https://www.franklins.co.im/vans/renault/kangoomaxi/1.5-dci-95-ll21-startstop-start/1155033/">View</a></div><div class="list-box-wrapper"><h2><strong>FORD</strong> FOCUS</h2><h3>Car (2020)</h3><a class="view-car-details" href="https://www.franklins.co.im/cars/ford/focus/zetec/1234567/">View</a></div>`;
    const rows = extractFranklinsListBoxes(html, "https://www.franklins.co.im");
    const van = rows.find((row) => row.sourceVehicleId === "1155033");
    expect(van).toMatchObject({
      url: "https://www.franklins.co.im/vans/renault/kangoomaxi/1.5-dci-95-ll21-startstop-start/1155033/",
      sourceVehicleId: "1155033",
      vehicleType: "van",
      make: "RENAULT",
      model: "KANGOO MAXI",
    });
    const cars = rows.filter((row) => row.vehicleType === "car");
    expect(cars.length).toBeGreaterThan(0);
    expect(cars.every((row) => /^\d+$/.test(row.sourceVehicleId ?? "") && !row.url?.includes("/vans/"))).toBe(
      true,
    );
  });

  it("does not import a reserved vehicle as a priced listing", () => {
    const reconciled = {
      identityKey: "sourceVehicleId:1591091",
      identityKind: "sourceVehicleId",
      sources: ["used-cars"],
      preferredSource: "used-cars",
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
      contentHash: "hash",
      vehicle: {
        dealerKey: "franklins",
        sourceKey: "used-cars",
        platform: "html-structured",
        sourceVehicleId: "1591091",
        registration: null,
        vin: null,
        stockReference: null,
        make: "Ford",
        model: "Focus",
        derivative: "Zetec",
        year: 2018,
        firstRegistrationDate: null,
        mileage: 1000,
        pricePence: null,
        isPoa: false,
        fuel: "Petrol",
        transmission: "Manual",
        bodyType: null,
        colour: null,
        doors: null,
        seats: null,
        engineSize: null,
        enginePower: null,
        vehicleType: "car",
        description: "",
        locationName: null,
        detailUrl: null,
        imageUrls: [],
        availability: "reserved",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        scrapedAt: "2026-06-19T05:00:00.000Z",
        provenance: { startUrl: null, sourceKeys: ["used-cars"], rawIdentityHints: [] },
      },
    } satisfies ReconciledVehicle;
    expect(mapReconciledVehicle(reconciled).skipReason).toBe("reserved");
  });

  it("uses the existing founding and ocean slug formulas", () => {
    expect(foundingManagedSlug("franklins", "sourceVehicleId:1")).toBe(
      foundingListingSlug("franklins", "sourceVehicleId:1"),
    );
    const oceanSource = readFileSync("scripts/dealer-pack-audit-sync/production-source.ts", "utf8");
    expect(oceanSource).toContain("omv-${sha256(`ocean-managed:${identityKey}`)");
    const digest = createHash("sha256").update("ocean-managed:sourceVehicleId:1").digest("hex").slice(0, 32);
    expect(oceanManagedSlug("sourceVehicleId:1")).toBe(`omv-${digest}`);
  });
});
