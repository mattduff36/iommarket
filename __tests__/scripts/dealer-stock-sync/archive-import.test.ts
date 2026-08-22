import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveImages } from "../../../scripts/dealer-stock-sync/archive/images";
import { writeDealerArchive } from "../../../scripts/dealer-stock-sync/archive/write";
import {
  ArchiveImportSafetyError,
  assertArchiveDealerMatch,
  dryRunArchiveImport,
  reportArchiveImport,
} from "../../../scripts/dealer-stock-sync/import-from-archive";
import { runDealerPipeline } from "../../../scripts/dealer-stock-sync/pipeline";
import { dealerFixture, sourceResult, vehicle } from "./fixtures";
import type { ArchivedVehicle } from "../../../scripts/dealer-stock-sync/types";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("archive serialization and images", () => {
  it("writes vehicles and image metadata, including failed downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "dealer-stock-"));
    temps.push(root);
    const imageDir = join(root, "images");
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("fail")) return new Response(null, { status: 404 });
      return new Response(Buffer.from("abc"), { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const images = await archiveImages({
      imageDir,
      imageUrls: ["https://cdn.example.com/ok.jpg", "https://cdn.example.com/fail.jpg"],
      fetchImpl,
    });
    expect(images[0]?.status).toBe("ok");
    expect(images[0]?.checksum).toBeTruthy();
    expect(images[1]?.status).toBe("failed");

    const dealer = dealerFixture();
    const written = await writeDealerArchive({
      root,
      runId: "run-1",
      mirrorImages: false,
      result: {
        dealer,
        sourceResults: [sourceResult({ sourceKey: "used-cars", vehicles: [vehicle({ dealerKey: dealer.key })] })],
        reconciled: [
          {
            identityKey: "sourceVehicleId:stock-1",
            identityKind: "sourceVehicleId",
            sources: ["used-cars"],
            preferredSource: "used-cars",
            vehicle: vehicle({ dealerKey: dealer.key, sourceKey: "used-cars" }),
            priceMismatch: false,
            identityConflict: false,
            conflictReason: null,
            contentHash: "abc",
          },
        ],
        canArchive: true,
        scrapeStartedAt: "2026-08-22T12:00:00.000Z",
        scrapeFinishedAt: "2026-08-22T12:01:00.000Z",
      },
    });
    expect(written.manifest.uniqueVehicles).toBe(1);
    expect(written.vehicles[0]?.importable).toBe(true);
    expect(written.vehicles[0]?.images[0]?.status).toBe("skipped");
  });
});

describe("partial dealer failure and blocked sources", () => {
  it("continues when one source fails", async () => {
    const dealer = dealerFixture({
      sources: [
        {
          key: "ok",
          name: "ok",
          startUrl: null,
          connectorKey: "csv",
          required: false,
          dedicated: true,
        },
        {
          key: "blocked",
          name: "blocked",
          startUrl: null,
          connectorKey: "unknown",
          required: false,
          dedicated: true,
        },
      ],
    });
    const result = await runDealerPipeline(dealer, { delayMs: 0 });
    expect(result.sourceResults).toHaveLength(2);
    expect(result.sourceResults.some((item) => item.status === "no_public_stock")).toBe(true);
  });
});

describe("dry-run archive importer", () => {
  it("refuses a mismatched dealer name or key", () => {
    expect(() =>
      assertArchiveDealerMatch({
        archiveDealerKey: "athol-garage",
        archiveDisplayName: "Athol Garage",
        requestedDealerKey: "bcc-cars",
        expectedName: "Athol Garage",
      }),
    ).toThrow(ArchiveImportSafetyError);
    expect(() =>
      assertArchiveDealerMatch({
        archiveDealerKey: "athol-garage",
        archiveDisplayName: "Athol Garage",
        requestedDealerKey: "athol-garage",
        expectedName: "Wrong Name",
      }),
    ).toThrow(ArchiveImportSafetyError);
  });

  it("reports importability without writing listings", () => {
    const archived: ArchivedVehicle = {
      identityKey: "sourceVehicleId:stock-1",
      identityKind: "sourceVehicleId",
      sources: ["used-cars"],
      preferredSource: "used-cars",
      vehicle: vehicle({ dealerKey: "athol-garage", sourceKey: "used-cars" }),
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
      contentHash: "abc",
      importable: true,
      importSkipReason: null,
      images: [
        {
          originalUrl: "https://cdn.example.com/a.jpg",
          localPath: null,
          contentType: null,
          bytes: null,
          checksum: null,
          status: "skipped",
          error: null,
        },
      ],
    };
    const report = reportArchiveImport({ vehicles: [archived], remainingSlots: 100 });
    expect(report.archiveRecords).toBe(1);
    expect(report.validImportable).toBe(1);
    expect(report.wouldAdd).toBe(1);
    expect(report.listingCapOverflow).toBe(0);
  });

  it("refuses --apply", async () => {
    await expect(
      dryRunArchiveImport({
        dealerKey: "athol-garage",
        expectedName: "Athol Garage",
        runId: "missing",
        apply: true,
      }),
    ).rejects.toThrow("Apply is disabled");
  });
});
