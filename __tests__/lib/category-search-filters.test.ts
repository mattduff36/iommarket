import { describe, expect, it } from "vitest";
import { STORED_DECIMAL_PATTERN } from "@/lib/listings/numeric-attribute-search";
import {
  MOTORHOME_BODY_TYPES,
  VAN_BODY_TYPES,
  VAN_ROOF_HEIGHTS,
  VAN_WHEELBASES,
} from "@/lib/listings/vehicle-detail-catalog";
import {
  categoryExactFilters,
  categoryNumericFilters,
  categoryNumericListingIdQuery,
  categorySearchControls,
  resolveVehicleCategorySlug,
  scopeCategorySearchRecord,
} from "@/lib/search/category-filters";
import { buildSearchUrl, normalizeSearchParams } from "@/lib/search/search-url";

describe("category search filters", () => {
  it("resolves a category id through the supplied category label", () => {
    expect(resolveVehicleCategorySlug("van-id", [{ label: "Vans", value: "van-id" }])).toBe("van");
    expect(resolveVehicleCategorySlug("motorhome")).toBe("motorhome");
    expect(resolveVehicleCategorySlug("unknown-id", [{ label: "Boats", value: "unknown-id" }])).toBeNull();
  });

  it("uses exact van and motorhome catalogue options", () => {
    const van = categorySearchControls("van");
    const motorhome = categorySearchControls("motorhome");

    expect(van.selects.map((field) => field.key)).toEqual(["wheelbase", "roofHeight"]);
    expect(van.selects[0]?.options).toEqual(VAN_WHEELBASES);
    expect(van.selects[1]?.options).toEqual(VAN_ROOF_HEIGHTS);
    expect(van.ranges.map((field) => [field.key, field.min, field.max])).toEqual([
      ["payload", 0, 50_000],
      ["loadLength", 0.5, 20],
      ["gvw", 1, 50_000],
    ]);
    expect(motorhome.selects.map((field) => field.options.join("|"))).toEqual([
      "Fixed double|Island bed|Fixed twin/singles|Bunk beds|Drop-down bed|Overcab bed|Convertible lounge|Other",
      "Rear lounge|Rear bedroom|Rear kitchen|Rear washroom|Other",
    ]);
    expect(motorhome.ranges.map((field) => field.key)).toEqual([
      "berths",
      "beltedSeats",
      "overallLength",
      "mtplm",
    ]);
  });

  it("drops irrelevant, malformed, and out-of-range category values", () => {
    expect(normalizeSearchParams({
      category: "car",
      bodyType: "Hatchback",
      wheelbase: "Long",
      minBerths: "4",
      doors: "5",
    })).toEqual({ category: "car", bodyType: "Hatchback", doors: "5" });

    expect(normalizeSearchParams({
      category: "van",
      bodyType: "Hatchback",
      wheelbase: "Not a wheelbase",
      roofHeight: "High",
      minPayload: "1000",
      maxPayload: "500",
      minGvw: "999999",
      minLoadLength: "2.5",
      sleepingLayout: "Island bed",
      fuelType: "Diesel",
    })).toEqual({
      category: "van",
      roofHeight: "High",
      minLoadLength: "2.5",
      fuelType: "Diesel",
    });

    expect(normalizeSearchParams({
      category: "motorbike",
      bodyType: "Hatchback",
      doors: "2",
      minBootSpace: "100",
      maxBootSpace: "400",
      transmission: "Manual",
      seats: "2",
    })).toEqual({ category: "motorbike", transmission: "Manual", seats: "2" });

    expect(normalizeSearchParams({
      category: "motorhome",
      bodyType: MOTORHOME_BODY_TYPES[0],
      minBerths: "Infinity",
      maxBerths: "4",
      minMtplm: "3000.5",
      minOverallLength: "6.25",
      wheelbase: "Long",
    })).toEqual({
      category: "motorhome",
      bodyType: MOTORHOME_BODY_TYPES[0],
      maxBerths: "4",
      minOverallLength: "6.25",
    });
  });

  it("keeps valid category keys for an unresolved category id until the slug is known", () => {
    const unresolved = normalizeSearchParams({
      category: "cat_123",
      wheelbase: "Long",
      minBerths: "3",
      bodyType: VAN_BODY_TYPES[0],
    });
    expect(unresolved.wheelbase).toBe("Long");
    expect(unresolved.minBerths).toBe("3");

    const scoped = scopeCategorySearchRecord(unresolved, "van");
    expect(scoped.wheelbase).toBe("Long");
    expect(scoped.minBerths).toBeUndefined();
    expect(scoped.bodyType).toBe(VAN_BODY_TYPES[0]);
    expect(categoryExactFilters(scoped, "van")).toEqual([
      { slug: "wheelbase", values: ["Long"] },
    ]);
    expect(categoryNumericFilters(scoped, "car")).toEqual([]);
  });

  it("builds a parameterised numeric query from catalogue slugs and rejects bad bounds", () => {
    const filters = categoryNumericFilters({
      minPayload: "800",
      maxLoadLength: "4.5",
      minGvw: "3500",
    }, "van");
    const query = categoryNumericListingIdQuery(filters);
    let text = "";
    query.strings.forEach((part, index) => {
      text += part;
      if (index < query.values.length) text += `$${index + 1}`;
    });

    expect(filters.map((filter) => filter.slug)).toEqual(["payload-kg", "load-length-m", "gvw-kg"]);
    expect(text).toContain('FROM "Listing" l');
    expect(text).toContain('FROM "ListingAttributeValue" lav');
    expect(text).not.toContain("payload-kg");
    expect(query.values).toEqual([
      "payload-kg",
      STORED_DECIMAL_PATTERN,
      800,
      50_000,
      "load-length-m",
      STORED_DECIMAL_PATTERN,
      0.5,
      4.5,
      "gvw-kg",
      STORED_DECIMAL_PATTERN,
      3500,
      50_000,
    ]);
    expect(() => categoryNumericListingIdQuery([{ slug: "payload-kg", min: Number.POSITIVE_INFINITY }])).toThrow(/invalid/);
    expect(() => categoryNumericListingIdQuery([{ slug: "boot-space", min: 1 }])).toThrow(/invalid/);
    expect(buildSearchUrl({ category: "van" }, { wheelbase: "Long", minPayload: "800" })).toBe(
      "/search?category=van&wheelbase=Long&minPayload=800",
    );
  });
});
