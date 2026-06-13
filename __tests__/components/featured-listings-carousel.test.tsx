import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useEmblaCarousel from "embla-carousel-react";
import { FeaturedListingsCarousel } from "@/components/marketplace/home/featured-listings-carousel";

const scrollPrev = vi.fn();
const scrollNext = vi.fn();
const scrollTo = vi.fn();
const on = vi.fn();
const off = vi.fn();
const selectedScrollSnap = vi.fn();
const canScrollPrev = vi.fn();
const canScrollNext = vi.fn();
const scrollProgress = vi.fn();
const scrollSnapList = vi.fn();
const autoplayPlugin = {
  stop: vi.fn(),
  reset: vi.fn(),
  play: vi.fn(),
};

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [
    vi.fn(),
    {
      scrollPrev,
      scrollNext,
      scrollTo,
      on,
      off,
      selectedScrollSnap,
      canScrollPrev,
      canScrollNext,
      scrollProgress,
      scrollSnapList,
    },
  ]),
}));

vi.mock("embla-carousel-autoplay", () => ({
  default: vi.fn(() => autoplayPlugin),
}));

vi.mock("@/components/marketplace/listing-card", () => ({
  ListingCard: ({ title }: { title: string }) => (
    <article data-testid="mock-listing-card">{title}</article>
  ),
}));

describe("FeaturedListingsCarousel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockMatchMedia(false);
    selectedScrollSnap.mockReturnValue(0);
    canScrollPrev.mockReturnValue(true);
    canScrollNext.mockReturnValue(true);
    scrollProgress.mockReturnValue(0);
    scrollSnapList.mockReturnValue([0, 0.5]);
  });

  it("renders featured cards and wires the navigation controls", async () => {
    render(
      <FeaturedListingsCarousel
        listings={[
          {
            id: "one",
            title: "Roadster",
            price: 12000,
            href: "/listings/one",
          },
          {
            id: "two",
            title: "Tourer",
            price: 18000,
            href: "/listings/two",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Featured listings carousel")).toBeTruthy();
    expect(screen.getAllByTestId("mock-listing-card")).toHaveLength(2);
    expect(screen.queryByText("Featured Showcase")).toBeNull();
    expect(screen.queryByText(/^[0-9]{2} \/ [0-9]{2}$/)).toBeNull();

    const nextButton = screen.getByRole("button", {
      name: "Next featured listing",
    }) as HTMLButtonElement;

    await waitFor(() => {
      expect(nextButton.disabled).toBe(false);
    });

    fireEvent.click(nextButton);

    expect(scrollNext).toHaveBeenCalledTimes(1);
    expect(useEmblaCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ loop: true }),
      [autoplayPlugin],
    );
  });

  it("keeps controls disabled when there is only one featured listing", () => {
    render(
      <FeaturedListingsCarousel
        listings={[
          {
            id: "solo",
            title: "Only Listing",
            price: 9000,
            href: "/listings/solo",
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Previous featured listing" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Next featured listing" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Go to featured listing 1")).toBeNull();
  });
});
