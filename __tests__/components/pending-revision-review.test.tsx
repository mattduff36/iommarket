import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/marketplace/listing-photo", () => ({
  ListingPhoto: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

import { PendingRevisionReview } from "@/components/admin/pending-revision-review";

const live = {
  title: "Live van",
  description: "Live description",
  price: 100_000,
  categoryName: "Vans",
  regionName: "Douglas",
  attributes: [],
  imagePublicIds: ["live-1", "live-2"],
};

describe("pending revision admin review UI-REV-001", () => {
  it("renders every proposed replacement photo for visual inspection", () => {
    render(
      <PendingRevisionReview
        live={live}
        proposed={{
          ...live,
          imagePublicIds: ["live-1", "replacement-2"],
        }}
        proposedPhotos={[
          {
            url: "https://example.com/live-1.jpg",
            publicId: "live-1",
            provider: "EXTERNAL",
          },
          {
            url: "https://example.com/replacement-2.jpg",
            publicId: "replacement-2",
            provider: "EXTERNAL",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Proposed photos" })).toBeTruthy();
    expect(screen.getByAltText("Proposed photo 1")).toBeTruthy();
    expect(screen.getByAltText("Proposed photo 2")).toBeTruthy();
    expect(screen.getByText(/Live: Removed: live-2/)).toBeTruthy();
    expect(screen.getByText(/Proposed: Added: replacement-2/)).toBeTruthy();
  });
});
