// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingImageGallery } from "@/app/(public)/listings/[id]/listing-image-gallery";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.stubGlobal(
  "IntersectionObserver",
  class {
    root = null;
    rootMargin = "";
    thresholds = [0];
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  },
);

vi.stubGlobal(
  "ResizeObserver",
  class {
    disconnect() {}
    observe() {}
    unobserve() {}
  },
);

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

const images = [
  {
    id: "image-1",
    url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/one.webp",
    publicId: "demo/one",
    provider: "EXTERNAL" as const,
    width: 1600,
    height: 1000,
  },
  {
    id: "image-2",
    url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/two.webp",
    publicId: "demo/two",
    provider: "EXTERNAL" as const,
    width: 900,
    height: 1600,
  },
  {
    id: "image-3",
    url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/three.webp",
    publicId: "demo/three",
    provider: "EXTERNAL" as const,
    width: 1600,
    height: 1200,
  },
];

describe("ListingImageGallery", () => {
  it("keeps a decoded thumbnail when the large photo fails twice", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_PROVIDER", "imagekit");
    try {
      render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);
      const thumb = screen.getByRole("button", { name: "Show image 1 of 3" }).querySelector("img")!;
      Object.defineProperty(thumb, "naturalWidth", { value: 160 });
      fireEvent.load(thumb);
      const data = screen.getByTestId("listing-gallery-stage");
      const primary = data.querySelector('img[fetchpriority="high"]')!;
      fireEvent.error(primary);
      fireEvent.error(primary);
      expect(data.querySelector('[data-photo-fallback="thumbnail"]')).toHaveAttribute("src", thumb.src);
      expect(screen.getByText("1 / 3")).toBeVisible();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("advances to another photo when no thumbnail can replace the main photo", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_PROVIDER", "imagekit");
    try {
      render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);
      const primary = screen.getByTestId("listing-gallery-stage").querySelector('img[fetchpriority="high"]')!;
      fireEvent.error(primary);
      fireEvent.error(primary);
      expect(screen.getByText("2 / 3")).toBeVisible();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("offers a fresh attempt when the only photo cannot be loaded", () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_PROVIDER", "imagekit");
    try {
      render(<ListingImageGallery images={images.slice(0, 1)} title="Test Volvo" isSold={false} />);
      const primary = screen.getByRole("img", { name: "Test Volvo" });
      fireEvent.error(primary);
      fireEvent.error(primary);
      expect(screen.getByRole("status")).toHaveTextContent("Photos temporarily unavailable");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByRole("img", { name: "Test Volvo" })).not.toBe(primary);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("shows all thumbnails and swaps the main image when a thumbnail is clicked", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    expect(screen.getByRole("button", { name: "Show image 3 of 3" })).toBeTruthy();
    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[0].url);

    fireEvent.click(screen.getByRole("button", { name: "Show image 3 of 3" }));

    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[2].url);
  });

  it("opens a fullscreen viewer and browses between images", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Show image 2 of 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Open image gallery for Test Volvo" }));

    expect(screen.getAllByText("2 / 3")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(screen.getAllByText("3 / 3")).toHaveLength(2);
  });

  it("browses main gallery photos with visible controls", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[1].url);

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[0].url);
  });

  it("exposes swipeable hero and fullscreen stages with position indicators", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    const hero = screen.getByTestId("listing-gallery-stage");
    expect(hero).toHaveAttribute("aria-roledescription", "carousel");
    expect(hero.querySelector(".touch-pan-y")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.getByText("Swipe")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open image gallery for Test Volvo" }));

    const lightbox = screen.getByTestId("listing-lightbox-stage");
    expect(lightbox).toHaveAttribute("aria-roledescription", "carousel");
    expect(lightbox.querySelector(".touch-pan-y")).toBeTruthy();
    expect(screen.getByText("Swipe to browse")).toBeTruthy();
  });

  it("keeps previous and next controls at least 44px", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    expect(screen.getByRole("button", { name: "Previous photo" }).className).toContain("h-11");
    expect(screen.getByRole("button", { name: "Next photo" }).className).toContain("w-11");
  });
});
