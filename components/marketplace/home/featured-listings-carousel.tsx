"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const AUTOPLAY_DELAY_MS = 6000;

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
  const [hoveredEdge, setHoveredEdge] = React.useState<"prev" | "next" | null>(
    null,
  );
  const canNavigate = listings.length > 1;
  const autoplay = React.useRef(
    Autoplay({
      delay: AUTOPLAY_DELAY_MS,
      playOnInit: canNavigate,
      stopOnInteraction: false,
      stopOnMouseEnter: true,
      stopOnFocusIn: false,
    }),
  );
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: "start",
      loop: canNavigate,
      skipSnaps: false,
    },
    [autoplay.current],
  );
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const stopAutoplay = React.useCallback(() => {
    if (!canNavigate) return;
    autoplay.current.stop();
  }, [canNavigate]);

  const restartAutoplay = React.useCallback(() => {
    if (!canNavigate) return;
    autoplay.current.reset();
    autoplay.current.play();
  }, [canNavigate]);

  const updateControls = React.useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;

    updateControls();
    emblaApi.on("select", updateControls);
    emblaApi.on("reInit", updateControls);
    emblaApi.on("pointerDown", stopAutoplay);
    emblaApi.on("settle", restartAutoplay);

    return () => {
      emblaApi.off("select", updateControls);
      emblaApi.off("reInit", updateControls);
      emblaApi.off("pointerDown", stopAutoplay);
      emblaApi.off("settle", restartAutoplay);
    };
  }, [emblaApi, restartAutoplay, stopAutoplay, updateControls]);

  const scrollPrev = React.useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      if (!emblaApi) return;
      emblaApi.scrollPrev();
      restartAutoplay();

      if (event && event.detail > 0) {
        event.currentTarget.blur();
      }
    },
    [emblaApi, restartAutoplay],
  );

  const scrollNext = React.useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      if (!emblaApi) return;
      emblaApi.scrollNext();
      restartAutoplay();

      if (event && event.detail > 0) {
        event.currentTarget.blur();
      }
    },
    [emblaApi, restartAutoplay],
  );

  const scrollTo = React.useCallback(
    (index: number) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(index);
      restartAutoplay();
    },
    [emblaApi, restartAutoplay],
  );

  const handleBlurCapture = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;

      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }

      restartAutoplay();
    },
    [restartAutoplay],
  );

  const clearHoveredEdge = React.useCallback(() => {
    setHoveredEdge(null);
  }, []);

  return (
    <div
      className="group relative"
      aria-label="Featured listings carousel"
      aria-roledescription="carousel"
      data-testid="featured-listings-carousel"
      onFocusCapture={stopAutoplay}
      onBlurCapture={handleBlurCapture}
    >
      <div
        className="relative"
        data-testid="featured-listings-carousel-stage"
      >
        {canNavigate && (
          <>
            <div className="pointer-events-none absolute inset-y-3 left-0 z-10 w-12 bg-gradient-to-r from-canvas via-canvas/65 to-transparent sm:w-16" />
            <div className="pointer-events-none absolute inset-y-3 right-0 z-10 w-12 bg-gradient-to-l from-canvas via-canvas/65 to-transparent sm:w-16" />

            <div
              className="absolute inset-y-0 left-0 z-20 flex w-20 items-center justify-start sm:w-24"
              data-testid="featured-listings-carousel-prev-zone"
              onMouseEnter={() => setHoveredEdge("prev")}
              onMouseLeave={clearHoveredEdge}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-12 w-12 rounded-full border border-white/6 bg-graphite-950/15 text-metallic-500 shadow-[0_12px_30px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-all duration-fast ease-fast focus-visible:h-14 focus-visible:w-14 focus-visible:border-neon-blue-500/60 focus-visible:bg-graphite-950/85 focus-visible:text-white disabled:opacity-0",
                  hoveredEdge === "prev"
                    ? "!h-14 !w-14 !border-metallic-300/30 !bg-graphite-950/85 !text-white !shadow-[0_16px_40px_rgba(0,0,0,0.34)] !opacity-100 md:!opacity-100"
                    : "hover:h-14 hover:w-14 hover:border-metallic-300/30 hover:bg-graphite-950/85 hover:text-white hover:shadow-[0_16px_40px_rgba(0,0,0,0.34)] md:opacity-25 md:group-hover:opacity-60 md:hover:opacity-100",
                )}
                aria-label="Previous featured listing"
                disabled={!emblaApi || !canNavigate || !canScrollPrev}
                onClick={scrollPrev}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </div>
            <div
              className="absolute inset-y-0 right-0 z-20 flex w-20 items-center justify-end sm:w-24"
              data-testid="featured-listings-carousel-next-zone"
              onMouseEnter={() => setHoveredEdge("next")}
              onMouseLeave={clearHoveredEdge}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-12 w-12 rounded-full border border-white/6 bg-graphite-950/15 text-metallic-500 shadow-[0_12px_30px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-all duration-fast ease-fast focus-visible:h-14 focus-visible:w-14 focus-visible:border-neon-blue-500/60 focus-visible:bg-graphite-950/85 focus-visible:text-white disabled:opacity-0",
                  hoveredEdge === "next"
                    ? "!h-14 !w-14 !border-metallic-300/30 !bg-graphite-950/85 !text-white !shadow-[0_16px_40px_rgba(0,0,0,0.34)] !opacity-100 md:!opacity-100"
                    : "hover:h-14 hover:w-14 hover:border-metallic-300/30 hover:bg-graphite-950/85 hover:text-white hover:shadow-[0_16px_40px_rgba(0,0,0,0.34)] md:opacity-25 md:group-hover:opacity-60 md:hover:opacity-100",
                )}
                aria-label="Next featured listing"
                disabled={!emblaApi || !canNavigate || !canScrollNext}
                onClick={scrollNext}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </>
        )}

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="-ml-3 flex touch-pan-y touch-pinch-zoom sm:-ml-4">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="min-w-0 flex-[0_0_calc(50%-0.375rem)] pl-3 py-2 sm:flex-[0_0_calc(50%-0.75rem)] sm:pl-4 md:flex-[0_0_calc(25%-1.125rem)]"
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
                  imageSizes="(max-width: 767px) 50vw, 25vw"
                />
              </div>
            ))}
          </div>
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
                  className={`h-2 rounded-full transition-all duration-fast ease-fast ${
                    isSelected
                      ? "w-8 bg-neon-blue-400 shadow-[0_0_18px_rgba(0,163,255,0.65)]"
                      : "w-2 bg-white/20 hover:bg-white/40"
                  }`}
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
