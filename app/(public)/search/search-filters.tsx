"use client";

import { useRouter } from "next/navigation";
import { FilterPanel, type FilterOption } from "@/components/marketplace/filter-panel";
import { SearchBar } from "@/components/marketplace/search-bar";

const PRICE_MAX = 100000;
const MILEAGE_MAX = 150000;
const YEAR_MIN = 2000;
const YEAR_MAX = new Date().getFullYear() + 1;

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
        priceRange={[
          minPrice ? parseInt(minPrice, 10) : 0,
          maxPrice ? parseInt(maxPrice, 10) : PRICE_MAX,
        ]}
        priceMin={0}
        priceMax={PRICE_MAX}
        onPriceChange={(range) =>
          router.push(
            buildUrl({
              minPrice: range[0] > 0 ? String(range[0]) : undefined,
              maxPrice: range[1] < PRICE_MAX ? String(range[1]) : undefined,
            })
          )
        }
        mileageRange={[
          minMileage ? parseInt(minMileage, 10) : 0,
          maxMileage ? parseInt(maxMileage, 10) : MILEAGE_MAX,
        ]}
        mileageMin={0}
        mileageMax={MILEAGE_MAX}
        onMileageChange={(range) =>
          router.push(
            buildUrl({
              minMileage: range[0] > 0 ? String(range[0]) : undefined,
              maxMileage: range[1] < MILEAGE_MAX ? String(range[1]) : undefined,
            })
          )
        }
        yearRange={[
          minYear ? parseInt(minYear, 10) : YEAR_MIN,
          maxYear ? parseInt(maxYear, 10) : YEAR_MAX,
        ]}
        yearMin={YEAR_MIN}
        yearMax={YEAR_MAX}
        onYearChange={(range) =>
          router.push(
            buildUrl({
              minYear: range[0] > YEAR_MIN ? String(range[0]) : undefined,
              maxYear: range[1] < YEAR_MAX ? String(range[1]) : undefined,
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
