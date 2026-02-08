"use client";

import { useRouter } from "next/navigation";
import { FilterPanel } from "@/components/marketplace/filter-panel";

interface Props {
  categorySlug: string;
  minPrice?: string;
  maxPrice?: string;
}

export function CategoryFilters({ categorySlug, minPrice, maxPrice }: Props) {
  const router = useRouter();

  const priceRange: [number, number] = [
    minPrice ? parseInt(minPrice, 10) : 0,
    maxPrice ? parseInt(maxPrice, 10) : 100000,
  ];

  function handlePriceChange(range: [number, number]) {
    const params = new URLSearchParams();
    if (range[0] > 0) params.set("minPrice", String(range[0]));
    if (range[1] < 100000) params.set("maxPrice", String(range[1]));
    router.push(`/categories/${categorySlug}?${params.toString()}`);
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
    </div>
  );
}
