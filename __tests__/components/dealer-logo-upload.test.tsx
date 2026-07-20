import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerLogoUpload } from "@/app/(public)/dealer/profile/dealer-logo-upload";
import { DEALER_LOGO_MAX_FILE_SIZE_BYTES } from "@/lib/upload/dealer-logo";

vi.mock("next/image", () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img alt={alt} {...props} />
  ),
}));

describe("DealerLogoUpload", () => {
  afterEach(() => cleanup());

  it("shows the required empty logo upload prompt with a clear accessible name", () => {
    render(
      <DealerLogoUpload
        dealerName="Northshore Motors"
        logoUrl={null}
        onLogoChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Click here to upload your logo*")).not.toBeNull();
    expect(
      screen.getByLabelText("Upload dealer logo").getAttribute("type"),
    ).toBe("file");
    expect(screen.getByLabelText("Upload dealer logo").getAttribute("aria-describedby")).toBe(
      "dealer-logo-guidance dealer-logo-error",
    );
    expect(screen.queryByText("Click here to upload an avatar image")).toBeNull();
    expect(screen.queryByText("Add your dealer logo")).toBeNull();
  });

  it("shows an existing logo with change and remove actions", () => {
    render(
      <DealerLogoUpload
        dealerName="Northshore Motors"
        logoUrl="https://example.com/legacy-logo.png"
        onLogoChange={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Northshore Motors logo").getAttribute("src")).toBe(
      "https://example.com/legacy-logo.png",
    );
    expect(screen.getAllByText("Change logo")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove logo" })).not.toBeNull();
  });

  it("rejects invalid file types before upload", async () => {
    render(
      <DealerLogoUpload
        dealerName="Northshore Motors"
        logoUrl={null}
        onLogoChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Upload dealer logo");
    const invalidFile = new File(["<svg />"], "logo.svg", { type: "image/svg+xml" });

    fireEvent.change(input, { target: { files: [invalidFile] } });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Upload a PNG, JPG, GIF, or WebP image.",
    );
  });

  it("rejects oversized files before upload", async () => {
    render(
      <DealerLogoUpload
        dealerName="Northshore Motors"
        logoUrl={null}
        onLogoChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Upload dealer logo");
    const oversizedFile = new File(["logo"], "logo.png", { type: "image/png" });
    Object.defineProperty(oversizedFile, "size", {
      value: DEALER_LOGO_MAX_FILE_SIZE_BYTES + 1,
    });

    fireEvent.change(input, { target: { files: [oversizedFile] } });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Logo images must be 5 MB or smaller.",
    );
  });
});
