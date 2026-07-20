import { describe, expect, it } from "vitest";
import {
  LEGACY_REGION_SLUG_MAP,
  MARKETPLACE_REGIONS,
} from "@/lib/constants/regions";

describe("marketplace regions", () => {
  it("defines the six canonical regions in display order", () => {
    expect(MARKETPLACE_REGIONS).toEqual([
      { name: "IOM North", slug: "iom-north", sortOrder: 1 },
      { name: "IOM South", slug: "iom-south", sortOrder: 2 },
      { name: "IOM East", slug: "iom-east", sortOrder: 3 },
      { name: "IOM West", slug: "iom-west", sortOrder: 4 },
      { name: "IOM Central", slug: "iom-central", sortOrder: 5 },
      { name: "United Kingdom", slug: "uk", sortOrder: 6 },
    ]);
  });

  it("maps every legacy town to the approved broader region", () => {
    expect(LEGACY_REGION_SLUG_MAP).toEqual({
      ramsey: "iom-north",
      castletown: "iom-south",
      "port-erin": "iom-south",
      "port-st-mary": "iom-south",
      ballasalla: "iom-south",
      douglas: "iom-east",
      onchan: "iom-east",
      laxey: "iom-east",
      peel: "iom-west",
      "kirk-michael": "iom-west",
      "isle-of-man": "iom-central",
    });
  });
});
