import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
  NAVIGABLE_CARD_LINK_CLASS,
} from "@/components/ui/card-overlay-link";
import { DeleteSavedSearchButton } from "@/app/(public)/account/saved-searches/delete-saved-search-button";
import { ReportActions } from "@/app/(admin)/admin/reports/report-actions";
import { ReviewActions } from "@/app/(admin)/admin/reviews/review-actions";
import { DeleteImageButton } from "@/app/(admin)/admin/media/delete-image-button";

const deleteSavedSearchMock = vi.fn();
const updateReportStatusMock = vi.fn();
const moderateDealerReviewMock = vi.fn();
const adminDeleteImageMock = vi.fn();

vi.mock("@/actions/user-tools", () => ({
  deleteSavedSearch: (...args: unknown[]) => deleteSavedSearchMock(...args),
}));

vi.mock("@/actions/admin", () => ({
  updateReportStatus: (...args: unknown[]) => updateReportStatusMock(...args),
}));

vi.mock("@/actions/dealer-reviews", () => ({
  moderateDealerReview: (...args: unknown[]) => moderateDealerReviewMock(...args),
}));

vi.mock("@/actions/admin/media", () => ({
  adminDeleteImage: (...args: unknown[]) => adminDeleteImageMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("CardOverlayLink", () => {
  it("keeps sibling controls outside the primary overlay link", () => {
    const onDelete = vi.fn();

    render(
      <div className="relative">
        <CardOverlayLink href="/listings/listing-1" label="Open listing" />
        <button type="button" className={CARD_OVERLAY_CONTROL_CLASS} onClick={onDelete}>
          Delete
        </button>
      </div>,
    );

    const primaryLink = screen.getByRole("link", { name: "Open listing" });
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    expect(primaryLink).toHaveAttribute("href", "/listings/listing-1");
    expect(primaryLink.contains(deleteButton)).toBe(false);
    expect(NAVIGABLE_CARD_LINK_CLASS).toContain("ring-inset");

    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the production delete control outside the overlay and invokes only that action", async () => {
    deleteSavedSearchMock.mockResolvedValue({ data: { ok: true } });

    render(
      <div className="relative">
        <CardOverlayLink href="/search?q=bmw" label="Open BMW search" />
        <div className={CARD_OVERLAY_CONTROL_CLASS}>
          <DeleteSavedSearchButton savedSearchId="ss-1" />
        </div>
      </div>,
    );

    const primaryLink = screen.getByRole("link", { name: "Open BMW search" });
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    expect(primaryLink.contains(deleteButton)).toBe(false);

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteSavedSearchMock).toHaveBeenCalledWith({ savedSearchId: "ss-1" });
    });
  });

  it("keeps report moderation controls outside the overlay and saves only that action", async () => {
    updateReportStatusMock.mockResolvedValue({ data: { status: "REVIEWED" } });

    render(
      <div className="relative">
        <CardOverlayLink href="/listings/listing-1" label="Reported listing" />
        <div className={CARD_OVERLAY_CONTROL_CLASS}>
          <ReportActions reportId="rep-1" currentStatus="OPEN" />
        </div>
      </div>,
    );

    const primaryLink = screen.getByRole("link", { name: "Reported listing" });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(primaryLink.contains(saveButton)).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateReportStatusMock).toHaveBeenCalledWith({
        reportId: "rep-1",
        status: "OPEN",
        adminNotes: undefined,
      });
    });
  });

  it("keeps review moderation controls outside the overlay and saves only that action", async () => {
    moderateDealerReviewMock.mockResolvedValue({ data: { status: "APPROVED" } });

    render(
      <div className="relative">
        <CardOverlayLink href="/dealers/alpha-autos" label="Alpha Autos" />
        <div className={CARD_OVERLAY_CONTROL_CLASS}>
          <ReviewActions reviewId="rev-1" currentStatus="PENDING" />
        </div>
      </div>,
    );

    const primaryLink = screen.getByRole("link", { name: "Alpha Autos" });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(primaryLink.contains(saveButton)).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(moderateDealerReviewMock).toHaveBeenCalledWith({
        reviewId: "rev-1",
        status: "PENDING",
        adminNotes: undefined,
      });
    });
  });

  it("keeps the media delete control outside the overlay and invokes only that action", async () => {
    adminDeleteImageMock.mockResolvedValue({ data: { ok: true } });

    render(
      <div className="relative">
        <CardOverlayLink href="/listings/listing-1" label="Listing photo" />
        <div className={CARD_OVERLAY_CONTROL_CLASS}>
          <DeleteImageButton imageId="img-1" />
        </div>
      </div>,
    );

    const primaryLink = screen.getByRole("link", { name: "Listing photo" });
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(primaryLink.contains(deleteButton)).toBe(false);

    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(adminDeleteImageMock).toHaveBeenCalledWith("img-1");
    });
  });
});
