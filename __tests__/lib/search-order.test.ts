import { describe, expect, it } from "vitest";
import {
  SEARCH_SORT_OPTIONS,
  SELLER_LISTING_SORT_OPTIONS,
  compareAttributeSort,
  getSearchOrderBy,
  parseSearchSort,
  parseSellerListingSort,
  sortListingIdsByAttribute,
} from "@/lib/search/search-order";

const at = (iso: string) => new Date(iso);

describe("search sort options", () => {
  it("offers Most Recent plus age and mileage sorts, without oldest-on-site", () => {
    expect(SEARCH_SORT_OPTIONS.map((option) => option.label)).toEqual([
      "Featured first",
      "Most Recent",
      "Price low to high",
      "Price high to low",
      "Mileage (lowest)",
      "Mileage (highest)",
      "Newest (age)",
      "Oldest (age)",
    ]);
    expect(SEARCH_SORT_OPTIONS.map((option) => option.value)).not.toContain("oldest");
  });

  it("keeps Most Recent on the existing newest query value", () => {
    expect(SEARCH_SORT_OPTIONS.find((option) => option.label === "Most Recent")?.value).toBe(
      "newest",
    );
  });

  it("gives seller lists the same sorts without Featured first", () => {
    expect(SELLER_LISTING_SORT_OPTIONS.map((option) => option.value)).toEqual([
      "newest",
      "price_low",
      "price_high",
      "mileage_low",
      "mileage_high",
      "year_newest",
      "year_oldest",
    ]);
  });

  it("drops unknown and removed sorts to the surface default", () => {
    expect(parseSearchSort("oldest")).toBe("featured");
    expect(parseSearchSort("made-up")).toBe("featured");
    expect(parseSearchSort("mileage_low")).toBe("mileage_low");
    expect(parseSellerListingSort("oldest")).toBe("newest");
    expect(parseSellerListingSort("featured")).toBe("newest");
    expect(parseSellerListingSort("year_oldest")).toBe("year_oldest");
  });

  it("keeps column ordering for featured, most recent, and price", () => {
    expect(getSearchOrderBy("featured")).toEqual([
      { featured: "desc" },
      { createdAt: "desc" },
    ]);
    expect(getSearchOrderBy("newest")).toEqual([{ createdAt: "desc" }]);
    expect(getSearchOrderBy("price_low")).toEqual([
      { price: "asc" },
      { createdAt: "desc" },
    ]);
    expect(getSearchOrderBy("price_high")).toEqual([
      { price: "desc" },
      { createdAt: "desc" },
    ]);
  });
});

describe("attribute sort comparator", () => {
  const rows = [
    { id: "high-old", createdAt: at("2024-01-01T00:00:00.000Z"), value: "10000" },
    { id: "low-new", createdAt: at("2026-01-01T00:00:00.000Z"), value: "9000" },
    { id: "low-old", createdAt: at("2024-06-01T00:00:00.000Z"), value: "9000" },
    { id: "missing", createdAt: at("2025-01-01T00:00:00.000Z"), value: null },
    { id: "blank", createdAt: at("2023-01-01T00:00:00.000Z"), value: "  " },
    { id: "formatted", createdAt: at("2026-06-01T00:00:00.000Z"), value: "12,000" },
  ];

  it("sorts mileage numerically, with missing values last and newer adverts winning ties", () => {
    expect(sortListingIdsByAttribute(rows, "asc")).toEqual([
      "low-new",
      "low-old",
      "high-old",
      "formatted",
      "missing",
      "blank",
    ]);
  });

  it("sorts highest mileage first and still leaves missing values last", () => {
    expect(sortListingIdsByAttribute(rows, "desc")).toEqual([
      "high-old",
      "low-new",
      "low-old",
      "formatted",
      "missing",
      "blank",
    ]);
  });

  it("treats a newer advert as first when both values are missing", () => {
    expect(
      compareAttributeSort(
        { id: "older", createdAt: at("2020-01-01T00:00:00.000Z"), value: "n/a" },
        { id: "newer", createdAt: at("2026-01-01T00:00:00.000Z"), value: "" },
        "asc",
      ),
    ).toBeGreaterThan(0);
  });
});
