import * as React from "react";
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

describe("PHOTO-ORDER-A11Y-001 PHOTO-ORDER-PRIMARY-001 listing photo ordering", () => {
  it("makes another photo primary and announces the change", () => {
    render(<Harness />);

    expect(screen.queryByText("Crop photo to 16:10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Make primary" }));

    expect(screen.getByTestId("listing-photo-0")).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getByText(/is now primary/i)).toBeTruthy();
  });

  it("moves photos with explicit previous and next controls", () => {
    render(<Harness />);

    fireEvent.click(screen.getAllByRole("button", { name: "Move next" })[0]);
    expect(screen.getByText(/Moved photo to position 2/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move previous" }));
    expect(screen.getByText(/Moved photo to position 1/i)).toBeTruthy();
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
