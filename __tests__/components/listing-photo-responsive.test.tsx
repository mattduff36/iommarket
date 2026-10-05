// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingImageGallery } from "@/app/(public)/listings/[id]/listing-image-gallery";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import {
  LISTING_CARD_SIZES,
  LISTING_GALLERY_SIZES,
  LISTING_GALLERY_THUMB_SIZES,
  LISTING_LIGHTBOX_SIZES,
  LISTING_PHOTO_DELIVERY_WIDTHS,
} from "@/lib/images/delivery-widths";
import type { ListingPhotoSource } from "@/lib/images/photo";
import { listingPhotoDeliveryQuerySchema } from "@/lib/media/listing-photo-query";

const previousProvider = process.env.NEXT_PUBLIC_MEDIA_PROVIDER;
const previousCloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

afterEach(() => {
  process.env.NEXT_PUBLIC_MEDIA_PROVIDER = previousProvider;
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = previousCloud;
});

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

vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
});

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const landscape: ListingPhotoSource = {
  id: "img-landscape",
  url: "https://res.cloudinary.com/demo/image/private/v12/iommarket/listings/staging/user/landscape.jpg",
  publicId: "iommarket/listings/staging/user/landscape",
  provider: "CLOUDINARY",
  version: "12",
  width: 3000,
  height: 2000,
};

const portrait: ListingPhotoSource = {
  ...landscape,
  id: "img-portrait",
  publicId: "iommarket/listings/staging/user/portrait",
  width: 900,
  height: 1600,
  focalX: 0.2,
  focalY: 0.8,
};

function widthParam(url: string) {
  return Number(new URL(url, "http://localhost").searchParams.get("w"));
}

function candidates(image: HTMLElement) {
  const srcSet = image.getAttribute("srcset") ?? "";
  return srcSet.split(",").filter((part) => part.trim()).map((part) => {
    const [url, descriptor] = part.trim().split(/\s+/);
    return {
      url: url ?? "",
      requested: widthParam(url ?? ""),
      advertised: Number((descriptor ?? "").replace("w", "")),
    };
  });
}

function slotCssPixels(sizes: string, viewport: number) {
  for (const part of sizes.split(",").map((item) => item.trim())) {
    const matched = part.match(/^\(max-width:\s*(\d+)px\)\s+(.+)$/);
    if (!matched) return cssLength(part, viewport);
    if (viewport <= Number(matched[1])) return cssLength(matched[2] ?? "", viewport);
  }
  return viewport;
}

function cssLength(value: string, viewport: number) {
  if (value.endsWith("vw")) return (viewport * Number.parseFloat(value)) / 100;
  if (value.endsWith("px")) return Number.parseFloat(value);
  throw new Error(`Unsupported size ${value}`);
}

function browserChoice(widths: number[], slot: number, dpr: number) {
  const target = slot * dpr;
  const sorted = [...widths].sort((left, right) => left - right);
  return sorted.find((width) => width >= target) ?? sorted[sorted.length - 1];
}

function expectProtectedCandidates(image: HTMLElement) {
  const rendered = candidates(image);
  const src = image.getAttribute("src") ?? "";
  expect(rendered.length).toBeGreaterThan(1);
  expect(src).toContain("/api/media/listing-photo?");
  expect(src).not.toContain("res.cloudinary.com");
  expect(src).not.toContain("/_next/image");
  for (const candidate of rendered) {
    expect(candidate.url).toContain("/api/media/listing-photo?");
    expect(candidate.url).not.toContain("res.cloudinary.com");
    expect(candidate.url).not.toContain("/_next/image");
    expect(candidate.requested).toBe(candidate.advertised);
    expect(LISTING_PHOTO_DELIVERY_WIDTHS).toContain(candidate.advertised);
    const parsed = new URL(candidate.url, "http://localhost");
    expect(listingPhotoDeliveryQuerySchema.safeParse({
      imageId: parsed.searchParams.get("imageId"),
      mode: parsed.searchParams.get("mode"),
      frame: parsed.searchParams.get("frame"),
      source: parsed.searchParams.get("source") ?? undefined,
      w: String(candidate.requested),
    }).success).toBe(true);
  }
  expect(widthParam(src)).toBe(rendered[rendered.length - 1]?.advertised);
  return rendered.map((candidate) => candidate.advertised);
}

describe("listing photo responsive delivery", () => {
  it("requests gallery pixel widths instead of the 16:10 aspect ratio", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    render(
      <ListingPhoto
        photo={landscape}
        frame="gallery"
        alt="Gallery landscape"
        sizes={LISTING_GALLERY_SIZES}
      />,
    );

    const image = screen.getByAltText("Gallery landscape");
    const widths = expectProtectedCandidates(image);
    expect(widths).not.toContain(16);
    expect(image.getAttribute("sizes")).toBe(LISTING_GALLERY_SIZES);

    expect(browserChoice(widths, slotCssPixels(LISTING_GALLERY_SIZES, 390), 3)).toBeGreaterThanOrEqual(960);
    expect(browserChoice(widths, slotCssPixels(LISTING_GALLERY_SIZES, 1100), 1)).toBe(800);
    expect(browserChoice(widths, slotCssPixels(LISTING_GALLERY_SIZES, 1440), 1)).toBe(800);
    expect(browserChoice(widths, slotCssPixels(LISTING_GALLERY_SIZES, 1440), 2)).toBe(1600);
    expect(browserChoice(widths, slotCssPixels(LISTING_LIGHTBOX_SIZES, 1920), 2)).toBe(2400);
  });

  it("keeps the blurred pad behind a sharp portrait foreground", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    const { container } = render(
      <ListingPhoto
        photo={portrait}
        frame="gallery"
        alt="Gallery portrait"
        sizes={LISTING_GALLERY_SIZES}
      />,
    );
    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    const blur = images[0];
    const foreground = images[1];
    expect(blur?.getAttribute("aria-hidden")).toBe("true");
    expect(blur?.className).toContain("blur-xl");
    expect(blur?.getAttribute("loading")).toBe("lazy");
    expect(blur?.getAttribute("fetchpriority")).toBe("low");
    expect(widthParam(blur?.getAttribute("src") ?? "")).toBe(320);
    expect(blur?.getAttribute("srcset")).toBeNull();
    const widths = expectProtectedCandidates(foreground!);
    expect(Math.min(...widths)).toBeGreaterThan(320);
    expect(foreground?.className).toContain("object-contain");
    expect(foreground?.style.objectPosition).toBe("center");
  });

  it("signs mapped Cloudinary rows, native ImageKit files, sample mode and revisions", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    const native: ListingPhotoSource = {
      ...landscape,
      id: "img-native",
      provider: "IMAGEKIT",
      publicId: "imagekit-dev/file-1",
      url: "imagekit-private:/iommarket-dev-disposable/user/intent/photo.jpg",
      deliverySource: "revision",
    };
    const { unmount } = render(
      <ListingPhoto photo={native} frame="preview" alt="Revision upload" sizes={LISTING_GALLERY_SIZES} />,
    );
    const revision = candidates(screen.getByAltText("Revision upload"));
    expect(revision.every((candidate) => candidate.url.includes("source=revision"))).toBe(true);
    expect(revision.every((candidate) => candidate.url.includes("imagekit-private"))).toBe(false);
    unmount();

    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit-sample";
    render(<ListingPhoto photo={landscape} frame="card" alt="Sample mapped" sizes={LISTING_CARD_SIZES} />);
    const sample = screen.getByAltText("Sample mapped");
    expectProtectedCandidates(sample);
    expect(sample.getAttribute("src")).not.toContain("res.cloudinary.com");
  });

  it("does not advertise fill widths larger than the original", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    render(
      <ListingPhoto
        photo={{ ...landscape, width: 1000, height: 750 }}
        frame="card"
        alt="Small original"
        sizes={LISTING_CARD_SIZES}
      />,
    );
    const widths = expectProtectedCandidates(screen.getByAltText("Small original"));
    expect(Math.max(...widths)).toBeLessThanOrEqual(960);
  });

  it("keeps an explicit unoptimized provider image on a ladder width", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    render(
      <ListingPhoto
        photo={landscape}
        frame="gallery"
        alt="Fallback listing"
        sizes={LISTING_GALLERY_SIZES}
        unoptimized
      />,
    );
    const image = screen.getByAltText("Fallback listing");
    expect(image.getAttribute("srcset")).toBeNull();
    expect(widthParam(image.getAttribute("src") ?? "")).toBe(1200);
    expect(image.getAttribute("src")).toContain("/api/media/listing-photo?");
  });

  it("leaves Cloudinary rollback and external images off the signing route", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "cloudinary";
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const { unmount } = render(
      <ListingPhoto photo={landscape} frame="card" alt="Rollback listing" sizes={LISTING_CARD_SIZES} />,
    );
    const rollback = screen.getByAltText("Rollback listing");
    const rollbackSrc = `${rollback.getAttribute("src") ?? ""} ${rollback.getAttribute("srcset") ?? ""}`;
    expect(rollbackSrc).toContain("res.cloudinary.com");
    expect(rollbackSrc).not.toContain("/api/media/listing-photo");
    unmount();

    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    render(
      <ListingPhoto
        photo={{
          url: "https://images.unsplash.com/photo-demo",
          publicId: "demo/legacy",
          provider: "EXTERNAL",
          width: 800,
          height: 600,
        }}
        frame="admin"
        alt="External listing"
        sizes="200px"
      />,
    );
    expect(screen.getByAltText("External listing").getAttribute("src")).toBe(
      "https://images.unsplash.com/photo-demo",
    );
  });

  it("uses layout sizes for gallery, lightbox, thumbs and does not max-size the thumbs", () => {
    process.env.NEXT_PUBLIC_MEDIA_PROVIDER = "imagekit";
    render(
      <ListingImageGallery
        images={[landscape, portrait]}
        title="Mapped Volvo"
        isSold={false}
      />,
    );

    const stage = screen.getByTestId("listing-gallery-stage");
    const foreground = within(stage).getByAltText("Mapped Volvo");
    expect(foreground.getAttribute("sizes")).toBe(LISTING_GALLERY_SIZES);
    const galleryWidths = expectProtectedCandidates(foreground);
    expect(browserChoice(galleryWidths, slotCssPixels(LISTING_GALLERY_SIZES, 390), 3)).toBeGreaterThanOrEqual(960);

    const thumb = screen.getByAltText("Mapped Volvo image 1");
    expect(thumb.getAttribute("sizes")).toBe(LISTING_GALLERY_THUMB_SIZES);
    const thumbWidths = expectProtectedCandidates(thumb);
    expect(browserChoice(thumbWidths, slotCssPixels(LISTING_GALLERY_THUMB_SIZES, 390), 3)).toBeLessThanOrEqual(480);

    fireEvent.click(screen.getByRole("button", { name: "Open image gallery for Mapped Volvo" }));
    const lightbox = screen.getByTestId("listing-lightbox-stage");
    const full = within(lightbox).getByAltText("Mapped Volvo image 1");
    expect(full.getAttribute("sizes")).toBe(LISTING_LIGHTBOX_SIZES);
    const fullWidths = expectProtectedCandidates(full);
    expect(browserChoice(fullWidths, slotCssPixels(LISTING_LIGHTBOX_SIZES, 1440), 2)).toBe(2400);
    expect(browserChoice(fullWidths, slotCssPixels(LISTING_LIGHTBOX_SIZES, 1440), 1)).toBe(1600);
  });
});
