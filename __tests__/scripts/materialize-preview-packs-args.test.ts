import { describe, expect, it } from "vitest";
import {
  packNeedsUpload,
  parseMaterializeArgs,
  pendingPreviewPacks,
  selectedPreviewPacks,
} from "../../scripts/materialize-preview-packs/args";

describe("preview pack materialize CLI args", () => {
  it("parses dealer, dry-run, and leave-hidden flags", () => {
    expect(
      parseMaterializeArgs([
        "node",
        "script",
        "--dealer",
        "athol-garage",
        "--dry-run",
        "--leave-hidden",
      ]),
    ).toEqual({
      dealerKey: "athol-garage",
      dryRun: true,
      leaveHidden: true,
    });
    expect(parseMaterializeArgs(["node", "script"])).toEqual({
      dealerKey: null,
      dryRun: false,
      leaveHidden: false,
    });
  });

  it("selects only packs that still need a first upload", () => {
    const rows = [
      {
        dealerKey: "athol-garage",
        displayName: "Athol Garage",
        materialized: false,
      },
      {
        dealerKey: "mikes-motors",
        displayName: "Mikes Motors",
        materialized: true,
      },
    ];
    expect(pendingPreviewPacks(rows, null).map((row) => row.dealerKey)).toEqual([
      "athol-garage",
    ]);
    expect(pendingPreviewPacks(rows, "mikes-motors")).toEqual([]);
    expect(pendingPreviewPacks(rows, "athol-garage")).toEqual([rows[0]]);
    expect(selectedPreviewPacks(rows, null).map((row) => row.dealerKey)).toEqual([
      "athol-garage",
      "mikes-motors",
    ]);
    expect(packNeedsUpload({ create: 0, backfill: 1, missingImages: 3 })).toBe(true);
    expect(packNeedsUpload({ create: 0, backfill: 0, missingImages: 0 })).toBe(false);
  });
});
