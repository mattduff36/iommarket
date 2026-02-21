"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { buildSearchUrl, type SearchParams } from "@/lib/search/search-url";

interface ListingItem {
  id: string;
  title: string;
  price: number;
  featured: boolean;
  imageSrc?: string;
  categoryName: string;
  regionName: string;
}

interface Props {
  initialListings: ListingItem[];
  total: number;
  pageSize: number;
  queryParams: SearchParams;
}

type ViewMode = "grid" | "list";

export function ListingResultsClient({
  initialListings,
  total,
  pageSize,
  queryParams,
}: Props) {
  const [items, setItems] = useState<ListingItem[]>(initialListings);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const hasMore = items.length < total;

  const queryString = useMemo(() => {
    const url = buildSearchUrl(queryParams, {});
    const [, qs] = url.split("?");
    return qs ?? "";
  }, [queryParams]);

  useEffect(() => {
    setItems(initialListings);
    setPage(1);
  }, [initialListings]);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const target = loaderRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          void loadMore();
        });
      },
      { rootMargin: "200px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  });

  async function loadMore() {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const nextPage = page + 1;
    const response = await fetch(`/api/search?${queryString}&page=${nextPage}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await response.json()) as { listings: ListingItem[] };
    setItems((prev) => [...prev, ...data.listings]);
    setPage(nextPage);
    setIsLoading(false);
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {total} result{total !== 1 ? "s" : ""} found
        </p>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "grid" ? "energy" : "ghost"}
            onClick={() => setViewMode("grid")}
          >
            Grid
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "list" ? "energy" : "ghost"}
            onClick={() => setViewMode("list")}
          >
            List
          </Button>
        </div>
      </div>

      <div
        className={cn(
          viewMode === "grid"
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6"
            : "space-y-3"
        )}
      >
        {items.map((listing) => (
          <div
            key={listing.id}
            className={cn(
              viewMode === "list" &&
                "rounded-lg border border-border p-3 bg-surface"
            )}
          >
            <ListingCard
              title={listing.title}
              price={listing.price / 100}
              imageSrc={listing.imageSrc}
              location={listing.regionName}
              meta={listing.categoryName}
              featured={listing.featured}
              badge={listing.featured ? "Featured" : undefined}
              href={`/listings/${listing.id}`}
            />
          </div>
        ))}
      </div>

      {hasMore ? (
        <div ref={loaderRef} className="py-6 text-center text-sm text-text-secondary">
          {isLoading ? "Loading more listings..." : "Scroll for more"}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-text-secondary">End of results</p>
      )}
    </>
  );
}
