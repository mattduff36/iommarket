import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageUpload, type UploadedImage } from "@/components/marketplace/image-upload";

const uploadListingImageFile = vi.fn();

vi.mock("@/lib/images/client-upload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/images/client-upload")>(
    "@/lib/images/client-upload",
  );
  return {
    ...actual,
    uploadListingImageFile: (...args: unknown[]) => uploadListingImageFile(...args),
  };
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

const first: UploadedImage = {
  id: "img-1",
  uploadIntentId: "intent-1",
  url: "https://example.com/one.jpg",
  publicId: "iommarket/listings/one",
  provider: "CLOUDINARY",
  width: 1600,
  height: 1000,
  order: 0,
};

const second: UploadedImage = {
  id: "img-2",
  uploadIntentId: "intent-2",
  url: "https://example.com/two.jpg",
  publicId: "iommarket/listings/two",
  provider: "CLOUDINARY",
  width: 900,
  height: 1600,
  order: 1,
};

function Harness({
  initial = [first, second],
  maxImages,
}: {
  initial?: UploadedImage[];
  maxImages?: number;
}) {
  const [images, setImages] = React.useState(initial);
  return <ImageUpload images={images} onImagesChange={setImages} maxImages={maxImages} />;
}

function openPhotoActions(photoNumber: number) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `More actions for photo ${photoNumber}` }),
    { button: 0, ctrlKey: false },
  );
}

describe("PHOTO-ORDER-A11Y-001 PHOTO-ORDER-PRIMARY-001 listing photo ordering", () => {
  it("makes another photo the cover and announces the change", () => {
    render(<Harness />);

    expect(screen.queryByText("Crop photo to 16:10")).toBeNull();
    expect(screen.getByText("Cover photo")).toBeTruthy();
    openPhotoActions(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Make cover photo" }));

    expect(screen.getByTestId("listing-photo-0")).toBeTruthy();
    expect(
      screen.getByText("Moved photo to position 1. Photo 1 is now the cover photo."),
    ).toBeTruthy();
  });

  it("moves photos with explicit previous and next controls", () => {
    render(<Harness />);

    const moveFirstRight = screen.getByRole("button", { name: "Move photo 1 right" });
    const moveFirstLeft = screen.getByRole("button", { name: "Move photo 1 left" });
    expect(moveFirstLeft).toHaveAttribute("aria-disabled", "true");
    expect(moveFirstRight).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(moveFirstRight);
    expect(screen.getByText(/Moved photo to position 2/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move photo 2 left" }));
    expect(screen.getByText(/Moved photo to position 1/i)).toBeTruthy();
  });

  it("removes a photo from the explicit actions menu", () => {
    render(<Harness />);

    openPhotoActions(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove photo" }));

    expect(screen.queryByAltText("Upload 2")).toBeNull();
    expect(screen.getByText("Photos (1/10)")).toBeTruthy();
    expect(screen.getByText("Removed photo 2.")).toBeTruthy();
  });

  it("preserves a focal point when the photo is reordered", () => {
    render(<Harness />);

    openPhotoActions(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Adjust focus" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Choose photo focus point" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save focus" }));
    expect(screen.getByText("Focus set")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Move photo 1 right" }));
    expect(screen.getByText("Focus set")).toBeTruthy();
  });
});

describe("PHOTO-ORDER-BATCH-001 listing photo batch order", () => {
  it("keeps file-selection order when later uploads finish first", async () => {
    uploadListingImageFile.mockReset();
    let finishSecond: ((value: UploadedImage) => void) | undefined;
    uploadListingImageFile
      .mockImplementationOnce(
        () =>
          new Promise<UploadedImage>((resolve) => {
            finishSecond = resolve;
          }),
      )
      .mockImplementationOnce(async () => ({
        ...second,
        uploadIntentId: "intent-batch-2",
        publicId: "iommarket/listings/batch-2",
      }));

    render(<Harness initial={[]} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [
      new File(["one"], "first.jpg", { type: "image/jpeg" }),
      new File(["two"], "second.jpg", { type: "image/jpeg" }),
    ];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      expect(uploadListingImageFile).toHaveBeenCalledTimes(2);
    });

    finishSecond?.({
      ...first,
      uploadIntentId: "intent-batch-1",
      publicId: "iommarket/listings/batch-1",
    });

    await waitFor(() => {
      expect(screen.getByTestId("listing-photo-0")).toBeTruthy();
      expect(screen.getByTestId("listing-photo-1")).toBeTruthy();
    });
    expect(screen.getByAltText("Upload 1").getAttribute("src")).toContain("one.jpg");
  });

  it("releases a failed upload slot so another photo can be selected", async () => {
    uploadListingImageFile.mockReset();
    uploadListingImageFile
      .mockRejectedValueOnce(new Error("Cloudinary rejected this file"))
      .mockResolvedValueOnce({
        ...first,
        uploadIntentId: "intent-ok",
        publicId: "iommarket/listings/ok",
      });

    render(<Harness initial={[]} maxImages={1} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["bad"], "bad.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => {
      expect(screen.getByText("Cloudinary rejected this file")).toBeTruthy();
    });

    fireEvent.change(input, {
      target: { files: [new File(["good"], "good.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("listing-photo-0")).toBeTruthy();
    });
    expect(screen.queryByText("Maximum 1 images allowed")).toBeNull();
  });
});
