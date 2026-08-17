import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingImageGallery } from "@/app/(public)/listings/[id]/listing-image-gallery";

const { emblaApis, emblaOptions, reducedMotion, reactRef } = vi.hoisted(() => ({
  emblaApis: [] as Array<{
    selectedScrollSnap: () => number;
    scrollTo: ReturnType<typeof vi.fn>;
    select: (index: number) => void;
  }>,
  emblaOptions: [] as Array<{ duration?: number; startIndex?: number }>,
  reducedMotion: { value: false },
  reactRef: { current: null as typeof React | null },
}));

reactRef.current = React;

vi.mock("embla-carousel-react", () => {
  function useEmblaCarouselMock(options: { duration?: number; startIndex?: number }) {
    const ReactModule = reactRef.current;
    if (!ReactModule) {
      throw new Error("React is not available for the Embla test mock");
    }
    emblaOptions.push(options);
    const [viewportRef] = ReactModule.useState(() => vi.fn());
    const [api] = ReactModule.useState(() => {
      let selectedIndex = options.startIndex ?? 0;
      const handlers = new Map<string, Set<() => void>>();
      const emit = (event: string) => {
        for (const handler of handlers.get(event) ?? []) handler();
      };
      const mockedApi = {
        selectedScrollSnap: () => selectedIndex,
        scrollTo: vi.fn((index: number) => {
          selectedIndex = index;
          emit("select");
        }),
        on(event: string, handler: () => void) {
          const eventHandlers = handlers.get(event) ?? new Set();
          eventHandlers.add(handler);
          handlers.set(event, eventHandlers);
          return mockedApi;
        },
        off(event: string, handler: () => void) {
          handlers.get(event)?.delete(handler);
          return mockedApi;
        },
        select(index: number) {
          selectedIndex = index;
          emit("select");
        },
      };
      emblaApis.push(mockedApi);
      return mockedApi;
    });
    return [viewportRef, api];
  }
  return {
    __esModule: true,
    default: useEmblaCarouselMock,
    useEmblaCarousel: useEmblaCarouselMock,
  };
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") && reducedMotion.value,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    unoptimized?: boolean;
    loader?: unknown;
  }) => {
    const imageProps = { ...props };
    delete imageProps.fill;
    delete imageProps.priority;
    delete imageProps.sizes;
    delete imageProps.unoptimized;
    delete imageProps.loader;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={imageProps.alt ?? ""} {...imageProps} />;
  },
}));

const images = [1, 2, 3].map((index) => ({
  id: `image-${index}`,
  url: `https://example.com/${index}.jpg`,
  publicId: `demo/${index}`,
  provider: "EXTERNAL" as const,
  width: 1600,
  height: 1000,
}));

describe("listing gallery Embla synchronization", () => {
  beforeEach(() => {
    emblaApis.length = 0;
    emblaOptions.length = 0;
    reducedMotion.value = false;
  });

  it("synchronizes hero and lightbox selection events", () => {
    render(<ListingImageGallery images={images} title="Synchronized car" isSold={false} />);

    act(() => emblaApis[0].select(1));
    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open image gallery for Synchronized car" }));
    expect(emblaApis).toHaveLength(2);

    act(() => emblaApis[1].select(2));
    expect(screen.getAllByText("3 / 3")).toHaveLength(2);
    expect(emblaApis[0].scrollTo).toHaveBeenLastCalledWith(2, false);
    expect(emblaApis[0].scrollTo).toHaveBeenCalledTimes(1);
    expect(emblaApis[1].scrollTo).not.toHaveBeenCalled();
  });

  it("uses instant Embla movement when reduced motion is requested", async () => {
    reducedMotion.value = true;
    render(<ListingImageGallery images={images} title="Reduced motion car" isSold={false} />);

    await waitFor(() => {
      expect(emblaOptions.some((options) => options.duration === 0)).toBe(true);
    });

    act(() => emblaApis[0].select(1));
    fireEvent.click(screen.getByRole("button", { name: "Open image gallery for Reduced motion car" }));
    act(() => emblaApis[1].select(2));

    expect(emblaApis[0].scrollTo).toHaveBeenCalledTimes(1);
    expect(emblaApis[0].scrollTo).toHaveBeenCalledWith(2, true);
    expect(emblaApis[1].scrollTo).not.toHaveBeenCalled();
  });
});
