"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface FeaturedListingsCarouselItem {
  id: string;
  title: string;
  price: number;
  imageSrc?: string;
  location?: string;
  meta?: string;
  href: string;
}

interface FeaturedListingsCarouselProps {
  listings: FeaturedListingsCarouselItem[];
}

export function FeaturedListingsCarousel({
  listings,
}: FeaturedListingsCarouselProps) {
  const canNavigate = listings.length > 1;
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: "center",
      loop: canNavigate,
      skipSnaps: false,
    },
  );
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);
  const [scrollProgress, setScrollProgress] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);

  const syncState = React.useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
    setScrollProgress(emblaApi.scrollProgress());
    setScrollSnaps(emblaApi.scrollSnapList());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;

    syncState();
    emblaApi.on("scroll", syncState);
    emblaApi.on("select", syncState);
    emblaApi.on("reInit", syncState);

    return () => {
      emblaApi.off("scroll", syncState);
      emblaApi.off("select", syncState);
      emblaApi.off("reInit", syncState);
    };
  }, [emblaApi, syncState]);

  const scrollPrev = React.useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      if (!emblaApi) return;
      emblaApi.scrollPrev();

      if (event && event.detail > 0) {
        event.currentTarget.blur();
      }
    },
    [emblaApi],
  );

  const scrollNext = React.useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      if (!emblaApi) return;
      emblaApi.scrollNext();

      if (event && event.detail > 0) {
        event.currentTarget.blur();
      }
    },
    [emblaApi],
  );

  const scrollTo = React.useCallback(
    (index: number) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(index);
    },
    [emblaApi],
  );

  function normalizeLoopValue(value: number): number {
    return ((value % 1) + 1) % 1;
  }

  function averageSnapStep(snaps: number[]): number {
    if (snaps.length < 2) return 1;

    const sorted = [...snaps].sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let index = 0; index < sorted.length - 1; index += 1) diffs.push(sorted[index + 1] - sorted[index]);
    diffs.push(1 + sorted[0] - sorted[sorted.length - 1]);

    return diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
  }

  function relativeSnapOffset(index: number): number {
    if (scrollSnaps.length === 0) return 0;

    const target = normalizeLoopValue(scrollSnaps[index] ?? 0);
    const progress = normalizeLoopValue(scrollProgress);
    const step = averageSnapStep(scrollSnaps);
    const rawDelta = target - progress;
    const loopedDeltas = [rawDelta, rawDelta + 1, rawDelta - 1];
    const nearestDelta = loopedDeltas.reduce((closest, delta) =>
      Math.abs(delta) < Math.abs(closest) ? delta : closest,
    );

    return nearestDelta / step;
  }

  return (
    <div
      className="group relative"
      aria-label="Featured listings carousel"
      aria-roledescription="carousel"
      data-testid="featured-listings-carousel"
    >
      <div className="pointer-events-none absolute inset-y-4 left-0 z-10 w-10 bg-gradient-to-r from-canvas/95 via-canvas/65 to-transparent sm:w-16" />
      <div className="pointer-events-none absolute inset-y-4 right-0 z-10 w-10 bg-gradient-to-l from-canvas/95 via-canvas/65 to-transparent sm:w-16" />

      {canNavigate && (
        <>
          <div className="absolute inset-y-0 left-1 z-20 flex items-center sm:left-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/10 bg-graphite-950/80 text-metallic-300 hover:border-neon-blue-500/60 hover:text-white"
              aria-label="Previous featured listing"
              disabled={!canScrollPrev}
              onClick={scrollPrev}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
          <div className="absolute inset-y-0 right-1 z-20 flex items-center sm:right-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/10 bg-graphite-950/80 text-metallic-300 hover:border-neon-blue-500/60 hover:text-white"
              aria-label="Next featured listing"
              disabled={!canScrollNext}
              onClick={scrollNext}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </>
      )}

      <div className="overflow-hidden py-3" ref={emblaRef} data-testid="featured-listings-carousel-stage">
        <div className="-ml-2 flex touch-pan-y touch-pinch-zoom sm:-ml-3">
          {listings.map((listing, index) => {
            const offset = relativeSnapOffset(index);
            const clampedOffset = Math.max(-2.6, Math.min(2.6, offset));
            const absOffset = Math.abs(clampedOffset);
            const focusStrength = Math.max(0, 1 - absOffset / 2.6);
            const isFocused = absOffset < 0.22;
            const scale = 0.72 + focusStrength * 0.28;
            const translateX = clampedOffset * -18;
            const translateY = absOffset * 10;
            const rotate = clampedOffset * 8.5;
            const opacity = 0.34 + focusStrength * 0.66;
            const zIndex = Math.max(1, Math.round((focusStrength + 0.1) * 100));

            return (
              <div
                key={listing.id}
                className="min-w-0 flex-[0_0_86%] pl-2 py-6 sm:flex-[0_0_60%] sm:pl-3 lg:flex-[0_0_44%]"
              >
                <article
                  className={cn(
                    "relative overflow-hidden rounded-xl border border-border bg-surface will-change-transform",
                    isFocused ? "shadow-[0_24px_64px_rgba(0,0,0,0.42)]" : "shadow-[0_14px_34px_rgba(0,0,0,0.28)]",
                  )}
                  style={{
                    opacity,
                    zIndex,
                    transformOrigin: "50% 120%",
                    transform: `translateX(${translateX}%) translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
                  }}
                >
                  <ListingCard
                    title={listing.title}
                    price={listing.price}
                    imageSrc={listing.imageSrc}
                    location={listing.location}
                    meta={listing.meta}
                    featured
                    badge="Featured"
                    href={listing.href}
                    className="h-full border-white/10 bg-surface/95"
                    imageSizes="(max-width: 640px) 85vw, (max-width: 1024px) 60vw, 44vw"
                  />
                </article>
              </div>
            );
          })}
        </div>
      </div>

      {canNavigate && (
        <div className="mt-4 flex justify-center">
          <div className="flex items-center gap-2">
            {listings.map((listing, index) => {
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={listing.id}
                  type="button"
                  className={cn(
                    "h-2 rounded-full transition-all duration-fast ease-fast",
                    isSelected
                      ? "w-8 bg-neon-blue-400 shadow-[0_0_18px_rgba(0,163,255,0.65)]"
                      : "w-2 bg-white/20 hover:bg-white/40",
                  )}
                  aria-label={`Go to featured listing ${index + 1}`}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => scrollTo(index)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
