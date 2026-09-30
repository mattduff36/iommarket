import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifySnapshot } from "@/scripts/dealer-pack-audit-sync/classify";
import {
  compareClassifiedDealer,
  compareDealerSource,
  normalizeSourceCompareIdentity,
  partitionOceanArchiveVehicles,
} from "@/scripts/dealer-pack-audit-sync/source-compare";
import type { PlannedListing } from "@/scripts/dealer-pack-audit-sync/types";
import { OCEAN_DEALER_KEY } from "@/lib/preview-packs/safety";
import type { ArchivedVehicle } from "@/scripts/dealer-stock-sync/types";
import { vehicle } from "./dealer-stock-sync/fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function validPngBytes() {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(1200, 16);
  bytes.writeUInt32BE(800, 20);
  return bytes;
}

async function archivedWithValidImage(
  overrides: Parameters<typeof vehicle>[0] = {},
  extra: Partial<ArchivedVehicle> = {},
): Promise<ArchivedVehicle> {
  const raw = vehicle(overrides);
  const root = await mkdtemp(join(tmpdir(), "source-compare-"));
  temporaryDirectories.push(root);
  const localPath = join(root, "ok.png");
  const bytes = validPngBytes();
  await writeFile(localPath, bytes);
  return archivedFrom(overrides, {
    ...extra,
    images: extra.images ?? [{
      originalUrl: raw.imageUrls[0]!,
      localPath,
      contentType: "image/png",
      bytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      status: "ok",
      error: null,
    }],
  });
}

function freshManifest(
  overrides: Partial<Parameters<typeof classifySnapshot>[0]["manifest"]> = {},
) {
  return {
    dealerKey: "athol-garage",
    displayName: "Athol Garage",
    canArchive: true,
    scrapeFinishedAt: new Date().toISOString(),
    sources: [{ key: "stock", required: true, status: "ok" as const }],
    ...overrides,
  };
}

function archivedFrom(
  overrides: Parameters<typeof vehicle>[0] = {},
  extra: Partial<ArchivedVehicle> = {},
): ArchivedVehicle {
  const raw = vehicle(overrides);
  const identityKey = extra.identityKey ?? `sourceVehicleId:${raw.sourceVehicleId}`;
  return {
    identityKey,
    identityKind: "sourceVehicleId",
    sources: [raw.sourceKey],
    preferredSource: raw.sourceKey,
    vehicle: raw,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "hash",
    importable: true,
    importSkipReason: null,
    images: [],
    ...extra,
  };
}

function mappedListing(title = "2022 Ford Focus ST-Line"): PlannedListing["listing"] {
  return {
    title,
    description: "A well specified Ford Focus with service history.",
    pricePence: 1_850_000,
    categorySlug: "car",
    attributes: {
      make: "Ford",
      model: "Focus",
      year: "2022",
      mileage: "12000",
      "write-off-category": "None",
      "fuel-type": "Petrol",
      transmission: "Manual",
    },
    imageUrls: ["https://cdn.example.com/a.jpg"],
  };
}

describe("dealer pack source compare", () => {
  it("matches planned and archive listings exactly after classifySnapshot", async () => {
    const manifest = freshManifest();
    const vehicles = [await archivedWithValidImage({ dealerKey: "athol-garage", sourceKey: "stock" })];
    const classified = classifySnapshot({ manifest, vehicles });
    expect(classified.listings).toHaveLength(1);

    const result = compareDealerSource({
      dealerKey: "athol-garage",
      displayName: "Athol Garage",
      preview: { kind: "replace", listings: classified.listings },
      production: { listings: classified.listings },
      snapshot: { manifest, vehicles },
    });

    expect(result.unexplainedCount).toBe(0);
    expect(result.listings).toEqual([
      expect.objectContaining({
        identityKey: "sourceVehicleId:stock-1",
        change: "unchanged",
        unexplained: false,
        targets: ["preview", "production"],
      }),
    ]);
  });

  it("fails closed when a managed dealer source cannot be compared", () => {
    const manifest = freshManifest({
      dealerKey: "mikes-motors",
      displayName: "Mike's Motors",
      sources: [{ key: "used-cars", required: true, status: "failed" }],
    });
    const planned: PlannedListing = {
      identityKey: "sourceVehicleId:keep-1",
      sourceUrl: "https://mikes.example/keep-1",
      listing: mappedListing("2022 Kept Car"),
      images: [{
        sourceUrl: "https://cdn.example.com/a.jpg",
        localPath: null,
        checksum: "planned",
        width: 1200,
        height: 800,
        format: "jpg",
        bytes: 1000,
        order: 0,
      }],
      findings: [],
    };

    const result = compareDealerSource({
      dealerKey: "mikes-motors",
      displayName: "Mike's Motors",
      preview: { kind: "disable", reasons: ["source-status-incomplete"], listings: [] },
      production: { listings: [planned] },
      snapshot: { manifest, vehicles: [] },
    });

    expect(result.sourceFailed).toBe(true);
    expect(result.stillUnsafe).toBe(false);
    expect(result.unexplainedCount).toBe(1);
    expect(result.listings[0]).toEqual(expect.objectContaining({
      identityKey: "sourceVehicleId:keep-1",
      change: "source_failed",
      unexplained: true,
      explanation: "required-source-incomplete",
    }));

    const disabledOnly = compareDealerSource({
      dealerKey: "unverifiable-dealer",
      displayName: "Unverifiable Dealer",
      preview: { kind: "disable", reasons: ["source-status-incomplete"], listings: [] },
      production: null,
      snapshot: { manifest, vehicles: [] },
    });
    expect(disabledOnly.unexplainedCount).toBe(0);
  });

  it("explains disabled packs that remain unsafe without treating archive extras as new", async () => {
    const manifest = freshManifest({
      canArchive: false,
      sources: [{ key: "stock", required: true, status: "ok" }],
    });
    const vehicles = [await archivedWithValidImage({ dealerKey: "dealer-a", sourceKey: "stock" })];

    const result = compareDealerSource({
      dealerKey: "dealer-a",
      displayName: "Dealer A",
      preview: { kind: "disable", reasons: ["manifest-cannot-archive"], listings: [] },
      production: null,
      snapshot: { manifest, vehicles },
    });

    expect(result.classifiedSafe).toBe(false);
    expect(result.stillUnsafe).toBe(true);
    expect(result.sourceFailed).toBe(false);
    expect(result.unexplainedCount).toBe(0);
    expect(result.listings.every((listing) =>
      listing.change === "explained_still_unsafe" && listing.unexplained === false,
    )).toBe(true);
  });

  it("maps Ocean stockId to archive sourceVehicleId and explains ineligible locations", async () => {
    expect(normalizeSourceCompareIdentity("stockId:21911132")).toBe(
      "sourceVehicleId:21911132",
    );
    const eligible = await archivedWithValidImage({
      sourceVehicleId: "21911132",
      locationName: "Ocean Ford",
    });
    const ineligible = archivedFrom({
      sourceVehicleId: "cit-99",
      locationName: "Ocean Citroën",
      make: "Citroen",
      model: "C3",
    }, { identityKey: "sourceVehicleId:cit-99" });
    expect(partitionOceanArchiveVehicles([eligible, ineligible])).toEqual({
      eligible: [eligible],
      ineligible: [ineligible],
    });

    const manifest = freshManifest({
      dealerKey: OCEAN_DEALER_KEY,
      displayName: "Ocean Motor Village",
    });
    const classifiedEligible = classifySnapshot({
      manifest,
      vehicles: [eligible],
    });
    const planned: PlannedListing = {
      ...classifiedEligible.listings[0]!,
      identityKey: "stockId:21911132",
    };

    const result = compareDealerSource({
      dealerKey: OCEAN_DEALER_KEY,
      displayName: "Ocean Motor Village",
      preview: { kind: "replace", listings: [planned] },
      production: { listings: [planned] },
      snapshot: { manifest, vehicles: [eligible, ineligible] },
    });

    expect(result.unexplainedCount).toBe(0);
    expect(result.ineligibleCount).toBe(1);
    expect(result.listings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identityKey: "sourceVehicleId:21911132",
        plannedIdentityKey: "stockId:21911132",
        archiveIdentityKey: "sourceVehicleId:21911132",
        change: "unchanged",
        unexplained: false,
      }),
      expect.objectContaining({
        identityKey: "sourceVehicleId:cit-99",
        change: "explained_ineligible",
        unexplained: false,
        explanation: "ocean-location-ineligible",
      }),
    ]));

    const oceanImage = {
      sourceUrl: "https://ocean.example/1.jpg",
      localPath: null,
      checksum: "ocean-1",
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 1000,
      order: 0,
    };
    const plannedWithImages = {
      ...planned,
      images: [
        oceanImage,
        { ...oceanImage, sourceUrl: "https://ocean.example/2.jpg", checksum: "ocean-2", order: 1 },
      ],
    };
    const represented = compareClassifiedDealer({
      dealerKey: OCEAN_DEALER_KEY,
      displayName: "Ocean Motor Village",
      preview: { kind: "replace", listings: [plannedWithImages] },
      production: { listings: [plannedWithImages] },
      archivePresent: true,
      manifest,
      classified: {
        safe: true,
        noPublicStock: false,
        reasons: [],
        listings: [{
          ...classifiedEligible.listings[0]!,
          images: [oceanImage],
          listing: {
            ...classifiedEligible.listings[0]!.listing,
            description: "Catalogue connector description",
            attributes: {
              ...classifiedEligible.listings[0]!.listing.attributes,
              colour: "Connector-normalized colour",
            },
          },
          findings: [
            "image-rejected:1:ignored asset",
            "image-rejected:9:HTTP 404",
          ],
        }],
      },
      ineligible: [],
    });
    expect(represented.unexplainedCount).toBe(0);
    expect(represented.listings[0]).toEqual(expect.objectContaining({
      change: "explained_connector_representation",
      unexplained: false,
    }));
  });

  it("reports checksum drift as modified and unexplained so completion cannot pass", () => {
    const listing = mappedListing("2022 Swift Car");
    const planned: PlannedListing = {
      identityKey: "sourceVehicleId:swift-1",
      sourceUrl: "https://swift.example/swift-1",
      listing,
      images: [{
        sourceUrl: "https://cdn.example.com/old.jpg",
        localPath: "archive/old.jpg",
        checksum: "checksum-old",
        width: 1200,
        height: 800,
        format: "jpg",
        bytes: 1000,
        order: 0,
      }],
      findings: [],
    };
    const archive: PlannedListing = {
      ...planned,
      images: [{
        ...planned.images[0]!,
        checksum: "checksum-new",
        sourceUrl: "https://cdn.example.com/new.jpg",
      }],
    };

    const result = compareClassifiedDealer({
      dealerKey: "swift-motors",
      displayName: "Swift Motors",
      preview: { kind: "replace", listings: [planned] },
      production: null,
      archivePresent: true,
      manifest: freshManifest({
        dealerKey: "swift-motors",
        displayName: "Swift Motors",
      }),
      classified: {
        safe: true,
        noPublicStock: false,
        reasons: [],
        listings: [archive],
      },
      ineligible: [],
    });

    expect(result.unexplainedCount).toBe(1);
    expect(result.listings[0]).toEqual(expect.objectContaining({
      change: "modified",
      unexplained: true,
      listingChanges: ["image-checksums"],
      explanation: "image-checksums-changed",
      plannedChecksums: ["checksum-old"],
      archiveChecksums: ["checksum-new"],
    }));
  });
});
