import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingPhotoFocalDialog } from "@/components/marketplace/listing-photo-focal-dialog";
import type { ListingPhotoSource } from "@/lib/images/photo";

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

const photo: ListingPhotoSource = {
  url: "https://example.com/photo.jpg",
  publicId: "iommarket/listings/photo",
  provider: "CLOUDINARY",
  width: 1600,
  height: 1000,
};

describe("PHOTO-FOCAL-001 listing photo focus", () => {
  it("saves a clicked focus point and can reset to automatic", () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <ListingPhotoFocalDialog photo={photo} open onOpenChange={onOpenChange} onSave={onSave} />,
    );

    expect(screen.getByAltText("Card preview")).toBeTruthy();
    expect(screen.getByAltText("Gallery preview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Choose photo focus point" }));
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        focalX: expect.any(Number),
        focalY: expect.any(Number),
      }),
    );

    rerender(
      <ListingPhotoFocalDialog
        photo={{ ...photo, focalX: 0.25, focalY: 0.4 }}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    expect(onSave).toHaveBeenCalledWith({ focalX: null, focalY: null });
  });
});
