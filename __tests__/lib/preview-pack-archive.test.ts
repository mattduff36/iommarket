import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findLatestRunForDealer,
  listAvailablePreviewArchives,
  mergePreviewPackRows,
} from "@/lib/preview-packs/archive";

const roots: string[] = [];

function writeManifest(
  root: string,
  runId: string,
  dealerKey: string,
  displayName: string,
  importable: number,
) {
  const dir = join(root, "runs", runId, dealerKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ dealerKey, displayName, uniqueVehicles: importable, importable }),
    "utf8",
  );
}

function makeArchive() {
  const root = join(
    tmpdir(),
    `preview-archive-index-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  writeManifest(root, "2026-08-22T18-00-00-000Z", "athol-garage", "Athol Garage", 12);
  writeManifest(root, "2026-08-22T18-00-00-000Z", "ocean-motor-village", "Ocean Motor Village", 41);
  writeManifest(root, "2026-08-22T22-00-00-000Z", "athol-garage", "Athol Garage", 14);
  writeManifest(root, "2026-08-22T22-00-00-000Z", "mikes-motors", "Mikes Motors", 34);
  writeFileSync(
    join(root, "latest.json"),
    JSON.stringify({ runId: "2026-08-22T22-00-00-000Z" }),
    "utf8",
  );
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("preview pack archive index", () => {
  it("lists every archived dealer from the newest snapshot and skips Ocean", async () => {
    const root = makeArchive();
    const listed = await listAvailablePreviewArchives(root);
    expect(listed.dealers.map((dealer) => dealer.dealerKey).sort()).toEqual([
      "athol-garage",
      "mikes-motors",
    ]);
    expect(listed.dealers.find((dealer) => dealer.dealerKey === "athol-garage")).toMatchObject({
      runId: "2026-08-22T22-00-00-000Z",
      importable: 14,
    });
    expect(findLatestRunForDealer("athol-garage", root)).toBe("2026-08-22T22-00-00-000Z");
    expect(findLatestRunForDealer("ocean-motor-village", root)).toBe("2026-08-22T18-00-00-000Z");
  });

  it("merges database packs with archive rows so each pack can be toggled alone", () => {
    const rows = mergePreviewPackRows({
      archives: [
        {
          dealerKey: "athol-garage",
          displayName: "Athol Garage",
          runId: "run-a",
          uniqueVehicles: 12,
          importable: 12,
        },
        {
          dealerKey: "mikes-motors",
          displayName: "Mikes Motors",
          runId: "run-m",
          uniqueVehicles: 34,
          importable: 34,
        },
      ],
      packs: [
        {
          dealerKey: "mikes-motors",
          displayName: "Mikes Motors",
          enabled: true,
          sourceRunId: "run-m",
          listingCount: 34,
          slug: "preview-mikes-motors",
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        dealerKey: "athol-garage",
        enabled: false,
        loaded: false,
        materialized: false,
        listingCount: 0,
      }),
      expect.objectContaining({
        dealerKey: "mikes-motors",
        enabled: true,
        loaded: true,
        materialized: true,
        listingCount: 34,
      }),
    ]);
  });

  it("marks empty database packs as loaded so Vercel can toggle them", () => {
    const rows = mergePreviewPackRows({
      archives: [],
      packs: [
        {
          dealerKey: "vehicles-im",
          displayName: "Vehicles.im",
          enabled: false,
          sourceRunId: "run-v",
          listingCount: 0,
          slug: "preview-vehicles-im",
        },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        dealerKey: "vehicles-im",
        loaded: true,
        materialized: false,
        enabled: false,
      }),
    ]);
  });
});
