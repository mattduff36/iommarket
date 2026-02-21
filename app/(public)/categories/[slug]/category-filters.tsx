"use client";

import { useRouter } from "next/navigation";
import { FilterPanel } from "@/components/marketplace/filter-panel";

interface RegionOption {
  label: string;
  value: string;
}

interface Props {
  categorySlug: string;
  regionSlug?: string;
  regions?: RegionOption[];
  minPrice?: string;
  maxPrice?: string;
}

export function CategoryFilters({
  categorySlug,
  regionSlug,
  regions = [],
  minPrice,
  maxPrice,
}: Props) {
  const router = useRouter();

  const priceRange: [number, number] = [
    minPrice ? parseInt(minPrice, 10) : 0,
    maxPrice ? parseInt(maxPrice, 10) : 100000,
  ];

  function buildUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = {
      region: regionSlug,
      minPrice,
      maxPrice,
      ...overrides,
    };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `/categories/${categorySlug}?${params.toString()}`;
  }

  function handlePriceChange(range: [number, number]) {
    router.push(
      buildUrl({
        minPrice: range[0] > 0 ? String(range[0]) : undefined,
        maxPrice: range[1] < 100000 ? String(range[1]) : undefined,
      })
    );
  }

  function handleReset() {
    router.push(`/categories/${categorySlug}`);
  }

  return (
    <div className="hidden lg:block">
      <FilterPanel
        priceRange={priceRange}
        priceMin={0}
        priceMax={100000}
        onPriceChange={handlePriceChange}
        onReset={handleReset}
      />
      {/* Region filter */}
      {regions.length > 0 && (
        <div className="border-t border-border pt-4 mt-4">
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
                        regionSlug === region.value ? undefined : region.value,
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
