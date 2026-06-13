export const SEARCH_SORT_OPTIONS = [
  { label: "Featured first", value: "featured" },
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Price low to high", value: "price_low" },
  { label: "Price high to low", value: "price_high" },
] as const;

export type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number]["value"];

export function parseSearchSort(value: string | null | undefined): SearchSort {
  return SEARCH_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as SearchSort)
    : "featured";
}

export function getSearchOrderBy(sort: SearchSort) {
  if (sort === "newest") return [{ createdAt: "desc" as const }];
  if (sort === "oldest") return [{ createdAt: "asc" as const }];
  if (sort === "price_low") return [{ price: "asc" as const }, { createdAt: "desc" as const }];
  if (sort === "price_high") return [{ price: "desc" as const }, { createdAt: "desc" as const }];
  return [{ featured: "desc" as const }, { createdAt: "desc" as const }];
}
