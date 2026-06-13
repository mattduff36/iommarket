import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingImageGallery } from "@/app/(public)/listings/[id]/listing-image-gallery";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    sizes: _sizes,
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    unoptimized?: boolean;
  }) => <img {...props} />,
}));

const images = [
  { id: "image-1", url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/one.webp" },
  { id: "image-2", url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/two.webp" },
  { id: "image-3", url: "https://res.cloudinary.com/demo/image/upload/v1/iommarket/listings/three.webp" },
];

describe("ListingImageGallery", () => {
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

    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  it("browses main gallery photos with visible controls", () => {
    render(<ListingImageGallery images={images} title="Test Volvo" isSold={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[1].url);

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByAltText("Test Volvo").getAttribute("src")).toBe(images[0].url);
  });
});
