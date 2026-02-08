"use client";

import { useRouter } from "next/navigation";
import { FilterPanel, type FilterOption } from "@/components/marketplace/filter-panel";
import { SearchBar } from "@/components/marketplace/search-bar";

interface Props {
  query: string;
  categorySlug?: string;
  regionSlug?: string;
  categories: FilterOption[];
  regions: FilterOption[];
  minPrice?: string;
  maxPrice?: string;
}

export function SearchFilters({
  query,
  categorySlug,
  regionSlug,
  categories,
  regions,
  minPrice,
  maxPrice,
}: Props) {
  const router = useRouter();

  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      q: query || undefined,
      category: categorySlug,
      region: regionSlug,
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
      {/* Region filter */}
      {regions.length > 0 && (
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">
            Region
          </h3>
          <div className="flex flex-col gap-1">
            {regions.map((region) => (
              <button
                key={region.value}
                type="button"
                onClick={() =>
                  router.push(
                    buildUrl({
                      region:
                        regionSlug === region.value
                          ? undefined
                          : region.value,
                    })
                  )
                }
                className={`text-left text-sm px-2 py-1 rounded transition-colors ${
                  regionSlug === region.value
                    ? "bg-royal-50 text-text-brand font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-slate-50"
                }`}
              >
                {region.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
