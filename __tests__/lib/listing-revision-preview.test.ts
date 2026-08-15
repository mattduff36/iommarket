import { describe, expect, it } from "vitest";
import { buildRevisionFieldDiffs } from "@/lib/listings/revision-preview";

describe("pending revision preview", () => {
  it("exposes live vs proposed field and photo changes for admin review", () => {
    const diffs = buildRevisionFieldDiffs(
      {
        title: "Old van",
        description: "Old body",
        price: 100000,
        categoryName: "Vans",
        regionName: "Douglas",
        attributes: [{ name: "Mileage", value: "40000" }],
        imagePublicIds: ["live-1", "live-2"],
      },
      {
        title: "Updated van",
        description: "New body",
        price: 150000,
        categoryName: "Vans",
        regionName: "Ramsey",
        attributes: [{ name: "Mileage", value: "41000" }],
        imagePublicIds: ["live-1", "new-3"],
      },
    );

    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "Title", live: "Old van", proposed: "Updated van" }),
        expect.objectContaining({ field: "Price" }),
        expect.objectContaining({ field: "Region", live: "Douglas", proposed: "Ramsey" }),
        expect.objectContaining({ field: "Mileage", live: "40000", proposed: "41000" }),
        expect.objectContaining({
          field: "Photos",
          live: "Removed: live-2",
          proposed: "Added: new-3",
        }),
      ]),
    );
  });

  it("detects photo replacements that keep the same count", () => {
    const diffs = buildRevisionFieldDiffs(
      {
        title: "Van",
        description: "Body",
        price: 100000,
        categoryName: "Vans",
        regionName: "Douglas",
        attributes: [],
        imagePublicIds: ["a", "b"],
      },
      {
        title: "Van",
        description: "Body",
        price: 100000,
        categoryName: "Vans",
        regionName: "Douglas",
        attributes: [],
        imagePublicIds: ["a", "c"],
      },
    );
    expect(diffs).toEqual([
      {
        field: "Photos",
        live: "Removed: b",
        proposed: "Added: c",
      },
    ]);
  });
});
