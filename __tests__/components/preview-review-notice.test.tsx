// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewReviewNotice } from "@/components/preview/preview-review-notice";
import { PreviewReviewImagePlaceholder } from "@/components/preview/preview-review-image-placeholder";

describe("preview review UI", () => {
  it("shows the pack review badge, reasons, and source run", () => {
    render(
      <PreviewReviewNotice
        reasons={["listing-has-no-valid-source-image"]}
        sourceRunId="run-2026-09-30"
      />,
    );

    expect(screen.getByText("Needs manual review")).toBeTruthy();
    expect(screen.getByText("Listing has no valid source image")).toBeTruthy();
    expect(screen.getByText("run-2026-09-30")).toBeTruthy();
  });

  it("links a listing source URL and keeps an explicit no-image placeholder", () => {
    render(
      <PreviewReviewNotice
        reasons={["listing-has-no-valid-source-image"]}
        sourceUrl="https://dealer.example/stock/12"
        sourceIdentityKey="stock:12"
      />,
    );
    const sourceLink = screen.getByRole("link", { name: "View source listing" });
    expect(sourceLink).toHaveAttribute("href", "https://dealer.example/stock/12");
    expect(screen.getByText("stock:12")).toBeTruthy();

    render(
      <PreviewReviewImagePlaceholder
        reasons={["listing-has-no-valid-source-image"]}
        sourceUrl="https://dealer.example/stock/12"
      />,
    );
    expect(screen.getAllByTestId("preview-review-no-image").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No source image").length).toBeGreaterThan(0);
  });
});
