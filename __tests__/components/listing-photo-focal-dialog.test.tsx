import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListingPhotoFocalDialog } from "@/components/marketplace/listing-photo-focal-dialog";
import type { ListingPhotoSource } from "@/lib/images/photo";

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

const photo: ListingPhotoSource = {
  url: "https://example.com/photo.jpg",
  publicId: "iommarket/listings/photo",
  provider: "CLOUDINARY",
  width: 1600,
  height: 1000,
};

describe("PHOTO-FOCAL-001 listing photo focus", () => {
  it("saves concrete pointer coordinates and closes when reset to automatic", () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <ListingPhotoFocalDialog photo={photo} open onOpenChange={onOpenChange} onSave={onSave} />,
    );

    expect(screen.getByAltText("Card preview")).toBeTruthy();
    expect(screen.getByAltText("Gallery preview")).toBeTruthy();

    const picker = screen.getByRole("button", { name: "Choose photo focus point" });
    vi.spyOn(picker, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    fireEvent.click(picker, { detail: 1, clientX: 60, clientY: 60 });
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));
    expect(onSave).toHaveBeenCalledWith({ focalX: 0.25, focalY: 0.4 });

    rerender(
      <ListingPhotoFocalDialog
        photo={{ ...photo, focalX: 0.25, focalY: 0.4 }}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use automatic focus" }));
    expect(onSave).toHaveBeenCalledWith({ focalX: null, focalY: null });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores coordinate-less keyboard activation and preserves the focal point", () => {
    const onSave = vi.fn();
    render(
      <ListingPhotoFocalDialog
        photo={{ ...photo, focalX: 0.3, focalY: 0.7 }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose photo focus point" }), {
      detail: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));

    expect(onSave).toHaveBeenCalledWith({ focalX: 0.3, focalY: 0.7 });
  });

  it("ignores non-primary pointer buttons", () => {
    const onSave = vi.fn();
    render(
      <ListingPhotoFocalDialog
        photo={{ ...photo, focalX: 0.2, focalY: 0.8 }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    const picker = screen.getByRole("button", { name: "Choose photo focus point" });
    fireEvent.pointerDown(picker, {
      pointerId: 2,
      button: 2,
      isPrimary: true,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));

    expect(onSave).toHaveBeenCalledWith({ focalX: 0.2, focalY: 0.8 });
  });

  it("supports keyboard nudging with bounded normalized coordinates", () => {
    const onSave = vi.fn();
    render(
      <ListingPhotoFocalDialog
        photo={{ ...photo, focalX: 0.99, focalY: 0.01 }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    const picker = screen.getByRole("button", { name: "Choose photo focus point" });
    fireEvent.keyDown(picker, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(picker, { key: "ArrowUp", shiftKey: true });
    expect(screen.getByText("Focus: 100% across, 0% down")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));
    expect(onSave).toHaveBeenCalledWith({ focalX: 1, focalY: 0 });
  });

  it("clamps pointer dragging to the photo bounds", () => {
    const onSave = vi.fn();
    render(
      <ListingPhotoFocalDialog photo={photo} open onOpenChange={vi.fn()} onSave={onSave} />,
    );

    const picker = screen.getByRole("button", { name: "Choose photo focus point" });
    vi.spyOn(picker, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 120,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(picker, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 150,
      clientY: -10,
    });
    fireEvent.pointerUp(picker, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 150,
      clientY: -10,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));

    expect(onSave).toHaveBeenCalledWith({ focalX: 1, focalY: 0 });
  });
});
