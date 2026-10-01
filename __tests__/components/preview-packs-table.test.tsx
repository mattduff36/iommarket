// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewPacksTable } from "@/app/(admin)/admin/preview-packs/preview-packs-table";
import type { PreviewPackListRow } from "@/lib/preview-packs/archive";

vi.mock("@/app/(admin)/admin/preview-packs/preview-pack-actions", () => ({
  PreviewPackActions: () => <div>actions</div>,
}));

function row(overrides: Partial<PreviewPackListRow>): PreviewPackListRow {
  return {
    dealerKey: "vehicles-im",
    displayName: "Vehicles.im",
    runId: "run-v",
    importable: 0,
    uniqueVehicles: 0,
    listingCount: 0,
    enabled: false,
    loaded: true,
    materialized: false,
    slug: "preview-vehicles-im",
    reviewRequired: true,
    reviewReasons: ["listing-has-no-valid-source-image"],
    reviewSourceRunId: "run-v",
    ...overrides,
  };
}

describe("PreviewPacksTable review display", () => {
  it("shows loaded zero-listing packs and their manual review state", () => {
    render(
      <PreviewPacksTable
        rows={[row({})]}
        archiveAvailable
        sort={{ column: "dealer", direction: "asc", explicit: false }}
        current={{}}
      />,
    );

    expect(screen.getByText("Vehicles.im")).toBeTruthy();
    expect(screen.getByText("Disabled · admin review only")).toBeTruthy();
    expect(screen.getByText("Needs manual review")).toBeTruthy();
    expect(screen.getByText("Listing has no valid source image")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View dealer" })).toHaveAttribute(
      "href",
      "/dealers/preview-vehicles-im",
    );
  });
});
