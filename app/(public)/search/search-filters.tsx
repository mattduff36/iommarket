"use client";

import { useRouter } from "next/navigation";
import { FilterPanel, type FilterOption } from "@/components/marketplace/filter-panel";
import { SearchBar } from "@/components/marketplace/search-bar";
import {
  MILEAGE_MAX,
  MILEAGE_MIN,
  PRICE_MAX,
  PRICE_MIN,
  YEAR_MIN,
  getCurrentYear,
  parseBoundedRange,
  parseYearRange,
} from "@/lib/constants/search-filters";

interface Props {
  query: string;
  categorySlug?: string;
  regionSlug?: string;
  categories: FilterOption[];
  regions: FilterOption[];
  minPrice?: string;
  maxPrice?: string;
  make?: string;
  model?: string;
  minMileage?: string;
  maxMileage?: string;
  minYear?: string;
  maxYear?: string;
  makes?: string[];
  models?: string[];
}

export function SearchFilters({
  query,
  categorySlug,
  regionSlug,
  categories,
  regions,
  minPrice,
  maxPrice,
  make,
  model,
  minMileage,
  maxMileage,
  minYear,
  maxYear,
  makes = [],
  models = [],
}: Props) {
  const router = useRouter();
  const currentYear = getCurrentYear();

  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      q: query || undefined,
      category: categorySlug,
      region: regionSlug,
      minPrice,
      maxPrice,
      make,
      model,
      minMileage,
      maxMileage,
      minYear,
      maxYear,
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
        priceRange={parseBoundedRange(minPrice, maxPrice, PRICE_MIN, PRICE_MAX)}
        priceMin={PRICE_MIN}
        priceMax={PRICE_MAX}
        onPriceChange={(range) =>
          router.push(
            buildUrl({
              minPrice: range[0] > PRICE_MIN ? String(range[0]) : undefined,
              maxPrice: range[1] < PRICE_MAX ? String(range[1]) : undefined,
            })
          )
        }
        mileageRange={parseBoundedRange(
          minMileage,
          maxMileage,
          MILEAGE_MIN,
          MILEAGE_MAX,
        )}
        mileageMin={MILEAGE_MIN}
        mileageMax={MILEAGE_MAX}
        onMileageChange={(range) =>
          router.push(
            buildUrl({
              minMileage: range[0] > MILEAGE_MIN ? String(range[0]) : undefined,
              maxMileage: range[1] < MILEAGE_MAX ? String(range[1]) : undefined,
            })
          )
        }
        yearRange={parseYearRange(minYear, maxYear)}
        yearMin={YEAR_MIN}
        yearMax={currentYear}
        onYearChange={(range) =>
          router.push(
            buildUrl({
              minYear: range[0] > YEAR_MIN ? String(range[0]) : undefined,
              maxYear: range[1] < currentYear ? String(range[1]) : undefined,
            })
          )
        }
        makes={makes}
        models={models}
        selectedMake={make}
        selectedModel={model}
        onMakeChange={(v) => router.push(buildUrl({ make: v || undefined }))}
        onModelChange={(v) => router.push(buildUrl({ model: v || undefined }))}
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
                    ? "bg-neon-blue-500/10 text-text-trust font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
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
