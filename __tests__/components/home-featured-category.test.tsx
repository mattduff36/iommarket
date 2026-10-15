// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturedListingsCarousel } from "@/components/marketplace/home/featured-listings-carousel";
import {
  HomeCategoryProvider,
  useHomeCategory,
  type HomeCategorySlug,
} from "@/components/marketplace/home/home-category-context";

const scrollTo = vi.hoisted(() => vi.fn());
const snaps = [0, 0.5, 1];

vi.mock("embla-carousel-react", () => ({
  __esModule: true,
  default: () => [
    vi.fn(),
    {
      scrollPrev: vi.fn(),
      scrollNext: vi.fn(),
      scrollTo,
      on: vi.fn(),
      off: vi.fn(),
      selectedScrollSnap: () => 0,
      canScrollPrev: () => true,
      canScrollNext: () => true,
      scrollProgress: () => 0,
      scrollSnapList: () => snaps,
    },
  ],
}));

vi.mock("embla-carousel-autoplay", () => ({
  __esModule: true,
  default: vi.fn(() => ({ stop: vi.fn(), reset: vi.fn(), play: vi.fn() })),
}));

vi.mock("@/components/marketplace/listing-card", () => ({
  ListingCard: ({ title }: { title: string }) => (
    <article data-testid="mock-listing-card">{title}</article>
  ),
}));

function ChooseCategory({ slug, label }: { slug: HomeCategorySlug; label: string }) {
  const category = useHomeCategory();
  return (
    <button type="button" onClick={() => category?.setCategory(slug)}>
      {label}
    </button>
  );
}

const listings = [
  { id: "car-a", title: "Car A", price: 1000, href: "/listings/car-a", categorySlug: "car" },
  { id: "van-b", title: "Van B", price: 2000, href: "/listings/van-b", categorySlug: "van" },
  { id: "car-c", title: "Car C", price: 3000, href: "/listings/car-c", categorySlug: "car" },
];

function titles() {
  return screen.getAllByTestId("mock-listing-card").map((card) => card.textContent);
}

describe("featured listings category priority", () => {
  beforeEach(() => {
    scrollTo.mockClear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  it("keeps the original order when no homepage category is selected", () => {
    render(<FeaturedListingsCarousel listings={listings} />);

    expect(titles()).toEqual(["Car A", "Van B", "Car C"]);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("prioritizes the selected category and resets to the first matching card", () => {
    render(
      <HomeCategoryProvider>
        <ChooseCategory slug="van" label="Choose vans" />
        <FeaturedListingsCarousel listings={listings} />
      </HomeCategoryProvider>,
    );

    expect(titles()).toEqual(["Car A", "Car C", "Van B"]);
    expect(scrollTo).toHaveBeenCalledWith(0);

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Choose vans" }));

    expect(titles()).toEqual(["Van B", "Car A", "Car C"]);
    expect(screen.getAllByTestId("mock-listing-card")).toHaveLength(3);
    expect(scrollTo).toHaveBeenCalledWith(0);
  });
});
