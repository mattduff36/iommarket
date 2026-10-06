export const SEARCH_SORT_OPTIONS = [
  { label: "Featured first", value: "featured" },
  { label: "Most Recent", value: "newest" },
  { label: "Price low to high", value: "price_low" },
  { label: "Price high to low", value: "price_high" },
  { label: "Mileage (lowest)", value: "mileage_low" },
  { label: "Mileage (highest)", value: "mileage_high" },
  { label: "Newest (age)", value: "year_newest" },
  { label: "Oldest (age)", value: "year_oldest" },
] as const;

export const SELLER_LISTING_SORT_OPTIONS = SEARCH_SORT_OPTIONS.filter(
  (option) => option.value !== "featured",
);

export type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number]["value"];
export type SellerListingSort = (typeof SELLER_LISTING_SORT_OPTIONS)[number]["value"];
export type AttributeSearchSort =
  | "mileage_low"
  | "mileage_high"
  | "year_newest"
  | "year_oldest";
export type ColumnSearchSort = Exclude<SearchSort, AttributeSearchSort>;

export type AttributeSortDirection = "asc" | "desc";

export interface AttributeSortRow {
  id: string;
  createdAt: Date;
  value: string | null;
}

const ATTRIBUTE_SORTS = new Set<AttributeSearchSort>([
  "mileage_low",
  "mileage_high",
  "year_newest",
  "year_oldest",
]);

export function parseSearchSort(value: string | null | undefined): SearchSort {
  return SEARCH_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SearchSort)
    : "featured";
}

export function parseSellerListingSort(
  value: string | null | undefined,
): SellerListingSort {
  return SELLER_LISTING_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SellerListingSort)
    : "newest";
}

export function isAttributeSearchSort(sort: SearchSort): sort is AttributeSearchSort {
  return ATTRIBUTE_SORTS.has(sort as AttributeSearchSort);
}

export function attributeSortSpec(sort: AttributeSearchSort): {
  slug: "mileage" | "year";
  direction: AttributeSortDirection;
} {
  if (sort === "mileage_low") return { slug: "mileage", direction: "asc" };
  if (sort === "mileage_high") return { slug: "mileage", direction: "desc" };
  if (sort === "year_newest") return { slug: "year", direction: "desc" };
  return { slug: "year", direction: "asc" };
}

export function getSearchOrderBy(sort: ColumnSearchSort) {
  if (sort === "newest") return [{ createdAt: "desc" as const }];
  if (sort === "price_low") return [{ price: "asc" as const }, { createdAt: "desc" as const }];
  if (sort === "price_high") return [{ price: "desc" as const }, { createdAt: "desc" as const }];
  return [{ featured: "desc" as const }, { createdAt: "desc" as const }];
}

export function parseWholeNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function compareAttributeSort(
  left: AttributeSortRow,
  right: AttributeSortRow,
  direction: AttributeSortDirection,
): number {
  const leftNumber = parseWholeNumber(left.value);
  const rightNumber = parseWholeNumber(right.value);
  if (leftNumber === null || rightNumber === null) {
    if (leftNumber === null && rightNumber === null) {
      return right.createdAt.getTime() - left.createdAt.getTime();
    }
    return leftNumber === null ? 1 : -1;
  }
  if (leftNumber !== rightNumber) {
    return direction === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
  }
  return right.createdAt.getTime() - left.createdAt.getTime();
}

export function sortListingIdsByAttribute(
  rows: readonly AttributeSortRow[],
  direction: AttributeSortDirection,
): string[] {
  return [...rows]
    .sort((left, right) => compareAttributeSort(left, right, direction))
    .map((row) => row.id);
}

export function restoreIdOrder<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
