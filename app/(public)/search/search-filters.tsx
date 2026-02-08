"use client";

import { useRouter } from "next/navigation";
import { FilterPanel, type FilterOption } from "@/components/marketplace/filter-panel";
import { SearchBar } from "@/components/marketplace/search-bar";

interface Props {
  query: string;
  categorySlug?: string;
  categories: FilterOption[];
  minPrice?: string;
  maxPrice?: string;
}

export function SearchFilters({
  query,
  categorySlug,
  categories,
  minPrice,
  maxPrice,
}: Props) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      q: query || undefined,
      category: categorySlug,
      minPrice,
      maxPrice,
      ...overrides,
    };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `/search?${params.toString()}`;
  }

  return (
    <div className="hidden lg:block space-y-4">
      <SearchBar
        value={query}
        placeholder="Refine search..."
        onSearch={(v) => router.push(buildUrl({ q: v || undefined }))}
        className="w-[280px]"
      />
      <FilterPanel
        categories={categories}
        selectedCategories={categorySlug ? [categorySlug] : []}
        onCategoryChange={(cats) =>
          router.push(buildUrl({ category: cats[0] || undefined }))
        }
        priceRange={[
          minPrice ? parseInt(minPrice, 10) : 0,
          maxPrice ? parseInt(maxPrice, 10) : 100000,
        ]}
        priceMin={0}
        priceMax={100000}
        onPriceChange={(range) =>
          router.push(
            buildUrl({
              minPrice: range[0] > 0 ? String(range[0]) : undefined,
              maxPrice: range[1] < 100000 ? String(range[1]) : undefined,
            })
          )
        }
        onReset={() => router.push("/search")}
      />
    </div>
  );
}
