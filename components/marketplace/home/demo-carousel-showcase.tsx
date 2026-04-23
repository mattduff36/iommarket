"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface DemoCarouselItem {
  id: string;
  title: string;
  price: number;
  imageSrc?: string;
  location?: string;
  meta?: string;
  href: string;
}

interface DemoCarouselShowcaseProps {
  items: DemoCarouselItem[];
}

function formatPrice(price: number): string {
  return `£${price.toLocaleString()}`;
}

function ensureMinimumSlides(items: DemoCarouselItem[], minimum = 7): DemoCarouselItem[] {
  if (items.length === 0) return [];
  if (items.length >= minimum) return items;

  const repeated = [...items];
  let cloneIndex = 0;
  while (repeated.length < minimum) {
    const base = items[cloneIndex % items.length];
    repeated.push({
      ...base,
      id: `${base.id}-demo-clone-${cloneIndex}`,
    });
    cloneIndex += 1;
  }
  return repeated;
}

function normalizeLoopValue(value: number): number {
  return ((value % 1) + 1) % 1;
}

function averageSnapStep(snaps: number[]): number {
  if (snaps.length < 2) return 1;

  const sorted = [...snaps].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    diffs.push(sorted[index + 1] - sorted[index]);
  }
  diffs.push(1 + sorted[0] - sorted[sorted.length - 1]);

  const total = diffs.reduce((sum, diff) => sum + diff, 0);
  return total / diffs.length;
}

function relativeSnapOffset(index: number, snaps: number[], scrollProgress: number): number {
  if (snaps.length === 0) return 0;

  const target = normalizeLoopValue(snaps[index] ?? 0);
  const progress = normalizeLoopValue(scrollProgress);
  const step = averageSnapStep(snaps);
  const rawDelta = target - progress;
  const loopedDeltas = [rawDelta, rawDelta + 1, rawDelta - 1];
  const nearestDelta = loopedDeltas.reduce((closest, delta) =>
    Math.abs(delta) < Math.abs(closest) ? delta : closest,
  );

  return nearestDelta / step;
}

function useCarouselState(
  itemCount: number,
  options: Parameters<typeof useEmblaCarousel>[0] = {},
) {
  const canNavigate = itemCount > 1;
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "center",
    loop: canNavigate,
    skipSnaps: false,
    ...options,
  });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const updateState = React.useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;
    updateState();
    emblaApi.on("select", updateState);
    emblaApi.on("reInit", updateState);
    return () => {
      emblaApi.off("select", updateState);
      emblaApi.off("reInit", updateState);
    };
  }, [emblaApi, updateState]);

  const scrollPrev = React.useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = React.useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollTo = React.useCallback(
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi],
  );

  return {
    emblaRef,
    emblaApi,
    selectedIndex,
    canScrollPrev,
    canScrollNext,
    canNavigate,
    scrollPrev,
    scrollNext,
    scrollTo,
  };
}

function ConceptSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface/70 p-4 sm:p-6">
      <div className="mb-4 sm:mb-5">
        <h2 className="section-heading-accent text-lg font-heading font-bold text-text-primary sm:text-xl">
          {title}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

function EdgeControls({
  previousLabel,
  nextLabel,
  canNavigate,
  canScrollPrev,
  canScrollNext,
  onPrev,
  onNext,
}: {
  previousLabel: string;
  nextLabel: string;
  canNavigate: boolean;
  canScrollPrev: boolean;
  canScrollNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!canNavigate) return null;

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-canvas/90 to-transparent sm:w-16" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-canvas/90 to-transparent sm:w-16" />

      <div className="absolute inset-y-0 left-1 z-20 flex items-center sm:left-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full border border-white/10 bg-graphite-950/80 text-metallic-300 hover:border-neon-blue-500/60 hover:text-white"
          aria-label={previousLabel}
          disabled={!canScrollPrev}
          onClick={onPrev}
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
          aria-label={nextLabel}
          disabled={!canScrollNext}
          onClick={onNext}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </>
  );
}

function DotControls({
  total,
  selectedIndex,
  onSelect,
  labelPrefix,
}: {
  total: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  labelPrefix: string;
}) {
  if (total < 2) return null;

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={`${labelPrefix}-${index}`}
            type="button"
            className={cn(
              "h-2 rounded-full transition-all duration-fast ease-fast",
              selected
                ? "w-8 bg-neon-blue-400 shadow-[0_0_14px_rgba(0,163,255,0.55)]"
                : "w-2 bg-white/20 hover:bg-white/40",
            )}
            aria-label={`${labelPrefix} ${index + 1}`}
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect(index)}
          />
        );
      })}
    </div>
  );
}

function SlideImage({ item }: { item: DemoCarouselItem }) {
  if (item.imageSrc) {
    return (
      <Image
        src={item.imageSrc}
        alt={item.title}
        fill
        className="object-cover transition-transform duration-fast ease-fast group-hover:scale-[1.03]"
        sizes="(max-width: 768px) 85vw, (max-width: 1280px) 45vw, 32vw"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-graphite-900 text-metallic-500">
      <span className="text-xs uppercase tracking-[0.22em]">No image available</span>
    </div>
  );
}

function SpotlightScaleCarousel({ items }: { items: DemoCarouselItem[] }) {
  const carousel = useCarouselState(items.length);

  return (
    <div className="group relative" aria-roledescription="carousel" aria-label="Spotlight scale carousel">
      <EdgeControls
        previousLabel="Previous spotlight slide"
        nextLabel="Next spotlight slide"
        canNavigate={carousel.canNavigate}
        canScrollPrev={carousel.canScrollPrev}
        canScrollNext={carousel.canScrollNext}
        onPrev={carousel.scrollPrev}
        onNext={carousel.scrollNext}
      />
      <div className="overflow-hidden" ref={carousel.emblaRef}>
        <div className="-ml-2 flex touch-pan-y touch-pinch-zoom sm:-ml-4">
          {items.map((item, index) => {
            const selected = index === carousel.selectedIndex;
            return (
              <div
                key={item.id}
                className="min-w-0 flex-[0_0_84%] pl-2 py-4 sm:flex-[0_0_58%] sm:pl-4 lg:flex-[0_0_40%]"
              >
                <article
                  className={cn(
                    "group relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-fast ease-fast",
                    selected
                      ? "scale-100 border-neon-blue-500/70 shadow-[0_18px_56px_rgba(0,163,255,0.26)]"
                      : "scale-[0.86] opacity-55",
                  )}
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <SlideImage item={item} />
                  </div>
                  <div className="space-y-2 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-metallic-400">Main Vehicle</p>
                    <h3 className="line-clamp-2 text-base font-semibold text-text-primary">{item.title}</h3>
                    <p className="text-lg font-bold text-text-energy">{formatPrice(item.price)}</p>
                    <p className="text-xs text-text-secondary">{[item.location, item.meta].filter(Boolean).join(" · ")}</p>
                    <Link href={item.href} className="text-sm font-medium text-text-trust hover:underline">
                      View listing
                    </Link>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <DotControls
        total={items.length}
        selectedIndex={carousel.selectedIndex}
        onSelect={carousel.scrollTo}
        labelPrefix="Go to spotlight slide"
      />
    </div>
  );
}

function PosterStageCarousel({ items }: { items: DemoCarouselItem[] }) {
  const carousel = useCarouselState(items.length);

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-surface-elevated to-surface p-3 sm:p-4"
      aria-roledescription="carousel"
      aria-label="Poster stage carousel"
    >
      <EdgeControls
        previousLabel="Previous poster slide"
        nextLabel="Next poster slide"
        canNavigate={carousel.canNavigate}
        canScrollPrev={carousel.canScrollPrev}
        canScrollNext={carousel.canScrollNext}
        onPrev={carousel.scrollPrev}
        onNext={carousel.scrollNext}
      />
      <div className="overflow-hidden" ref={carousel.emblaRef}>
        <div className="-ml-2 flex touch-pan-y touch-pinch-zoom sm:-ml-4">
          {items.map((item, index) => {
            const selected = index === carousel.selectedIndex;
            return (
              <div
                key={item.id}
                className="min-w-0 flex-[0_0_78%] pl-2 py-5 sm:flex-[0_0_52%] sm:pl-4 lg:flex-[0_0_34%]"
              >
                <article
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border bg-graphite-950 transition-all duration-fast ease-fast",
                    selected
                      ? "border-premium-gold-500/75 scale-100 shadow-[0_20px_64px_rgba(255,197,74,0.25)]"
                      : "border-white/10 scale-[0.88] opacity-60",
                  )}
                >
                  <div className="relative aspect-[4/5] overflow-hidden">
                    <SlideImage item={item} />
                    <div className="absolute inset-0 bg-gradient-to-t from-graphite-950 via-graphite-950/25 to-transparent" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-metallic-300">Poster Stage</p>
                    <h3 className="line-clamp-2 text-lg font-heading font-bold text-white">{item.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-premium-gold-400">{formatPrice(item.price)}</p>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <DotControls
        total={items.length}
        selectedIndex={carousel.selectedIndex}
        onSelect={carousel.scrollTo}
        labelPrefix="Go to poster slide"
      />
    </div>
  );
}

function DepthStackCarousel({ items }: { items: DemoCarouselItem[] }) {
  const carousel = useCarouselState(items.length);
  const [scrollProgress, setScrollProgress] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (!carousel.emblaApi) return;

    const syncMotionState = () => {
      setScrollProgress(carousel.emblaApi?.scrollProgress() ?? 0);
      setScrollSnaps(carousel.emblaApi?.scrollSnapList() ?? []);
    };

    syncMotionState();
    carousel.emblaApi.on("scroll", syncMotionState);
    carousel.emblaApi.on("select", syncMotionState);
    carousel.emblaApi.on("reInit", syncMotionState);

    return () => {
      carousel.emblaApi?.off("scroll", syncMotionState);
      carousel.emblaApi?.off("select", syncMotionState);
      carousel.emblaApi?.off("reInit", syncMotionState);
    };
  }, [carousel.emblaApi]);

  return (
    <div className="relative" aria-roledescription="carousel" aria-label="Depth stack carousel">
      <EdgeControls
        previousLabel="Previous depth slide"
        nextLabel="Next depth slide"
        canNavigate={carousel.canNavigate}
        canScrollPrev={carousel.canScrollPrev}
        canScrollNext={carousel.canScrollNext}
        onPrev={carousel.scrollPrev}
        onNext={carousel.scrollNext}
      />
      <div className="overflow-hidden py-3" ref={carousel.emblaRef}>
        <div className="-ml-2 flex touch-pan-y touch-pinch-zoom sm:-ml-3">
          {items.map((item, index) => {
            const offset = relativeSnapOffset(index, scrollSnaps, scrollProgress);
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
                key={item.id}
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
                  <div className="relative aspect-[14/9] overflow-hidden">
                    <SlideImage item={item} />
                    <div className="absolute inset-0 bg-gradient-to-t from-graphite-950/90 via-transparent to-transparent" />
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-1 text-base font-semibold text-text-primary">{item.title}</h3>
                    <p className="mt-1 text-sm font-bold text-text-energy">{formatPrice(item.price)}</p>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <DotControls
        total={items.length}
        selectedIndex={carousel.selectedIndex}
        onSelect={carousel.scrollTo}
        labelPrefix="Go to depth slide"
      />
    </div>
  );
}

function CinematicRailCarousel({ items }: { items: DemoCarouselItem[] }) {
  const carousel = useCarouselState(items.length, { dragFree: true });

  return (
    <div className="relative" aria-roledescription="carousel" aria-label="Cinematic rail carousel">
      <EdgeControls
        previousLabel="Previous cinematic slide"
        nextLabel="Next cinematic slide"
        canNavigate={carousel.canNavigate}
        canScrollPrev={carousel.canScrollPrev}
        canScrollNext={carousel.canScrollNext}
        onPrev={carousel.scrollPrev}
        onNext={carousel.scrollNext}
      />
      <div className="overflow-hidden" ref={carousel.emblaRef}>
        <div className="-ml-2 flex touch-pan-y touch-pinch-zoom sm:-ml-4">
          {items.map((item, index) => {
            const selected = index === carousel.selectedIndex;
            return (
              <div
                key={item.id}
                className="min-w-0 flex-[0_0_92%] pl-2 py-3 sm:flex-[0_0_70%] sm:pl-4 lg:flex-[0_0_56%]"
              >
                <article
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-white/10 bg-graphite-950 transition-all duration-fast ease-fast",
                    selected
                      ? "scale-100 border-neon-red-500/70 shadow-[0_24px_70px_rgba(255,59,59,0.28)]"
                      : "scale-[0.9] opacity-55",
                  )}
                >
                  <div className="relative aspect-[21/9] overflow-hidden">
                    <SlideImage item={item} />
                    <div className="absolute inset-0 bg-gradient-to-r from-graphite-950/90 via-graphite-950/25 to-transparent" />
                    <div className="absolute inset-y-0 left-0 flex max-w-[70%] flex-col justify-end p-4 sm:p-6">
                      <p className="text-xs uppercase tracking-[0.2em] text-neon-red-400">Centre Focus</p>
                      <h3 className="line-clamp-2 text-lg font-heading font-bold text-white sm:text-2xl">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm font-semibold text-metallic-100">
                        {formatPrice(item.price)} · {[item.location, item.meta].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <DotControls
        total={items.length}
        selectedIndex={carousel.selectedIndex}
        onSelect={carousel.scrollTo}
        labelPrefix="Go to cinematic slide"
      />
    </div>
  );
}

function HeroThumbCarousel({ items }: { items: DemoCarouselItem[] }) {
  const carousel = useCarouselState(items.length, { align: "center" });

  return (
    <div className="space-y-4" aria-roledescription="carousel" aria-label="Hero thumbnail carousel">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="absolute inset-y-0 left-2 z-20 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full border border-white/10 bg-graphite-950/80 text-metallic-300 hover:border-neon-blue-500/60 hover:text-white"
            aria-label="Previous hero slide"
            disabled={!carousel.canScrollPrev}
            onClick={carousel.scrollPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <div className="absolute inset-y-0 right-2 z-20 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full border border-white/10 bg-graphite-950/80 text-metallic-300 hover:border-neon-blue-500/60 hover:text-white"
            aria-label="Next hero slide"
            disabled={!carousel.canScrollNext}
            onClick={carousel.scrollNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-hidden" ref={carousel.emblaRef}>
          <div className="flex">
            {items.map((item) => (
              <div key={item.id} className="min-w-0 flex-[0_0_100%]">
                <article className="relative">
                  <div className="relative aspect-[21/9] min-h-[220px] overflow-hidden">
                    <SlideImage item={item} />
                    <div className="absolute inset-0 bg-gradient-to-t from-graphite-950 via-graphite-950/20 to-transparent" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-neon-blue-300">Hero Focus</p>
                    <h3 className="line-clamp-2 text-xl font-heading font-bold text-white sm:text-3xl">
                      {item.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-metallic-100">
                      <span className="font-semibold text-neon-blue-300">{formatPrice(item.price)}</span>
                      <span>{[item.location, item.meta].filter(Boolean).join(" · ")}</span>
                    </div>
                    <Link href={item.href} className="mt-2 inline-flex text-sm font-medium text-neon-blue-300 hover:text-neon-blue-200">
                      Open listing
                    </Link>
                  </div>
                </article>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-2 pb-1">
          {items.map((item, index) => {
            const selected = index === carousel.selectedIndex;
            return (
              <button
                key={`${item.id}-thumb`}
                type="button"
                onClick={() => carousel.scrollTo(index)}
                className={cn(
                  "group relative min-w-[120px] overflow-hidden rounded-lg border bg-surface text-left transition-all duration-fast ease-fast sm:min-w-[150px]",
                  selected
                    ? "border-neon-blue-500/70 shadow-[0_10px_26px_rgba(0,163,255,0.25)]"
                    : "border-border hover:border-metallic-400",
                )}
                aria-label={`Show hero slide ${index + 1}`}
                aria-current={selected ? "true" : undefined}
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <SlideImage item={item} />
                  <div className={cn("absolute inset-0 transition-colors", selected ? "bg-transparent" : "bg-graphite-950/50")} />
                </div>
                <div className="p-2">
                  <p className="line-clamp-1 text-xs font-medium text-text-primary">{item.title}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DemoCarouselShowcase({ items }: DemoCarouselShowcaseProps) {
  const showcaseItems = React.useMemo(() => ensureMinimumSlides(items), [items]);

  if (showcaseItems.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-heading font-semibold text-text-primary">No live listings available</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Publish or feature at least one live listing to preview carousel concepts here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ConceptSection
        title="Concept 01 - Spotlight Scale"
        description="A cinema-like lane where neighboring cards stay visible, while the center card scales up and carries the strongest visual weight."
      >
        <SpotlightScaleCarousel items={showcaseItems} />
      </ConceptSection>

      <ConceptSection
        title="Concept 02 - Poster Stage"
        description="Tall poster styling with a dramatic center frame and premium highlight ring, designed to feel editorial and promotional."
      >
        <PosterStageCarousel items={showcaseItems} />
      </ConceptSection>

      <ConceptSection
        title="Concept 03 - Depth Stack"
        description="A layered deck effect that gives depth and perspective, pushing side slides behind the active center frame."
      >
        <DepthStackCarousel items={showcaseItems} />
      </ConceptSection>

      <ConceptSection
        title="Concept 04 - Cinematic Rail"
        description="Wide panoramic slides with hard center lock, dramatic masks, and bold directional controls for a premium hero-strip feel."
      >
        <CinematicRailCarousel items={showcaseItems} />
      </ConceptSection>

      <ConceptSection
        title="Concept 05 - Hero + Thumbnails"
        description="A dominant hero panel paired with quick-select thumbnails, ideal when the center image must stay unmistakably primary."
      >
        <HeroThumbCarousel items={showcaseItems} />
      </ConceptSection>
    </div>
  );
}
