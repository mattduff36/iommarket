import { describe, expect, it } from "vitest";
import { mergeRawRecords } from "@/scripts/dealer-stock-sync/connectors/website-source";

describe("dealer website record merging", () => {
  it("deduplicates one vehicle URL even when extractors disagree on its ID", () => {
    const url = "https://dealer.example/inventory/vehicle-1";
    const merged = mergeRawRecords([
      [{ sourceVehicleId: "inventory/vehicle-1", url, make: "Ford" }],
      [{ sourceVehicleId: "vehicle-1", url, make: "Ford" }],
    ]);

    expect(merged).toHaveLength(1);
  });
});
