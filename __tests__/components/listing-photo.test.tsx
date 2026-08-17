import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingPhoto } from "@/components/marketplace/listing-photo";
import type { ListingPhotoSource } from "@/lib/images/photo";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    sizes: _sizes,
    unoptimized: _unoptimized,
    loader,
    className,
    alt,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    unoptimized?: boolean;
    loader?: (params: { src: string; width: number; quality?: number }) => string;
  }) => {
    void _fill;
    void _priority;
    void _sizes;
    void _unoptimized;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt}
        src={loader ? loader({ src: String(src), width: 640 }) : String(src)}
        className={className}
        {...props}
      />
    );
  },
}));

const portrait: ListingPhotoSource = {
  url: "https://example.com/portrait.jpg",
  publicId: "iommarket/listings/staging/user/portrait",
  provider: "CLOUDINARY",
  version: "12",
  width: 900,
  height: 1600,
};

const landscape: ListingPhotoSource = {
  url: "https://example.com/landscape.jpg",
  publicId: "iommarket/listings/staging/user/landscape",
  provider: "CLOUDINARY",
  version: "12",
  width: 1600,
  height: 1000,
};

const external: ListingPhotoSource = {
  url: "https://images.unsplash.com/photo-demo",
  publicId: "demo/legacy",
  provider: "EXTERNAL",
  width: 800,
  height: 600,
};

describe("PHOTO-RENDER-001 PHOTO-COMPAT-001 listing photo renderer", () => {
  it("pads portrait photos in landscape frames with a blurred background", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const { container } = render(
      <ListingPhoto
        photo={{ ...portrait, focalX: 0.2, focalY: 0.8 }}
        frame="gallery"
        alt="Portrait listing"
        sizes="100vw"
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(images[0]?.className).toContain("blur-xl");
    expect(images[0]?.style.objectPosition).toBe("20% 80%");
    expect(images[1]?.className).toContain("object-contain");
    expect(images[1]?.style.objectPosition).toBe("center");
    expect(screen.getByAltText("Portrait listing").getAttribute("src")).toContain("c_fit");
  });

  it("crops near-match landscape photos into cards", () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "demo-cloud";
    const { container } = render(
      <ListingPhoto
        photo={{ ...landscape, focalX: 0.25, focalY: 0.75 }}
        frame="card"
        alt="Landscape listing"
        sizes="33vw"
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.className).toContain("object-cover");
    expect(images[0]?.style.objectPosition).toBe("25% 75%");
    expect(screen.getByAltText("Landscape listing").getAttribute("src")).toContain("c_fill");
  });

  it("keeps the lightbox contained and uses a safe fallback for sample photos", () => {
    const { container } = render(
      <ListingPhoto
        photo={{ ...portrait, focalX: 0.1, focalY: 0.9 }}
        frame="gallery"
        variant="contain"
        alt="Lightbox listing"
        sizes="100vw"
      />,
    );
    expect(container.querySelector("img")?.className).toContain("object-contain");
    expect(container.querySelector("img")?.style.objectPosition).toBe("center");

    render(<ListingPhoto photo={external} frame="admin" alt="Sample listing" sizes="200px" />);
    expect(screen.getByAltText("Sample listing").getAttribute("src")).toBe(external.url);
  });
});
