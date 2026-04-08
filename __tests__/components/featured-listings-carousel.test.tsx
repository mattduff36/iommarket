import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturedListingsCarousel } from "@/components/marketplace/home/featured-listings-carousel";

const scrollPrev = vi.fn();
const scrollNext = vi.fn();
const scrollTo = vi.fn();
const on = vi.fn();
const off = vi.fn();
const selectedScrollSnap = vi.fn();
const canScrollPrev = vi.fn();
const canScrollNext = vi.fn();
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

    const initialPlayCount = autoplayPlugin.play.mock.calls.length;
    fireEvent.click(nextButton);

    expect(scrollNext).toHaveBeenCalledTimes(1);
    expect(autoplayPlugin.reset).toHaveBeenCalledTimes(1);
    expect(autoplayPlugin.play.mock.calls.length).toBe(initialPlayCount + 1);
  });

  it("shows the full arrow state when hovering inside the edge zone", () => {
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

    const nextZone = screen.getByTestId("featured-listings-carousel-next-zone");
    const nextButton = screen.getByRole("button", {
      name: "Next featured listing",
    });

    fireEvent.mouseEnter(nextZone);

    expect(nextButton.className).toContain("opacity-100");
    expect(nextButton.className).toContain("bg-graphite-950/85");

    fireEvent.mouseLeave(nextZone);

    expect(nextButton.className).toContain("md:opacity-25");
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

  it("uses the mobile-specific layout without arrow controls", () => {
    mockMatchMedia(true);

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

    expect(
      screen.queryByRole("button", { name: "Previous featured listing" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Next featured listing" }),
    ).toBeNull();

    expect(
      screen.getByTestId("featured-listings-carousel-mobile-scroller"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Go to featured listing 1")).toBeNull();
  });
});
