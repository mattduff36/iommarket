// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListingPreviewButton } from "@/app/(public)/sell/listing-preview-button";
import { ListingPreviewClient } from "@/app/(public)/sell/listing-preview-client";
import { loadListingPreview, listingPreviewKey, saveListingPreview } from "@/app/(public)/sell/listing-preview-data";
import type { DraftScope, UnsavedDraftSnapshot } from "@/app/(public)/sell/listing-unsaved-draft";

vi.mock("@/app/(public)/listings/[id]/listing-image-gallery", () => ({ ListingImageGallery: () => <div>Listing gallery</div> }));
const categories = [{ id: "cars", name: "Cars", slug: "cars", attributes: [{ id: "make", name: "Make", slug: "make" }] }];
const regions = [{ id: "douglas", name: "Douglas" }];
const scope: DraftScope = { userId: "user_a", mode: "private", catalog: { categories: [{ id: "cars", attributeIds: ["make"] }], regionIds: ["douglas"] } };
const snapshot: UnsavedDraftSnapshot = { categoryId: "cars", title: "Volvo V50", description: "A tidy car", price: "4500", regionId: "douglas", attributes: { make: "Volvo" }, registrationInput: "DMN 833 P", catalogueSelection: { makeMode: "manual", modelMode: "manual" }, photos: [], currentStep: 4 };

beforeEach(() => localStorage.clear());
describe("private listing preview", () => {
  it("opens a separate safe tab without submitting the form", () => {
    const submit = vi.fn();
    render(<form onSubmit={submit}><ListingPreviewButton scope={scope} snapshot={snapshot} /></form>);
    const link = screen.getByRole("link", { name: /Preview listing/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(link);
    expect(submit).not.toHaveBeenCalled();
    expect(loadListingPreview(localStorage, scope)?.title).toBe("Volvo V50");
  });
  it("isolates users and seller modes, and rejects malformed data", () => {
    saveListingPreview(localStorage, scope, snapshot);
    expect(loadListingPreview(localStorage, { ...scope, userId: "user_b" })).toBeNull();
    expect(loadListingPreview(localStorage, { ...scope, mode: "dealer" })).toBeNull();
    localStorage.setItem(listingPreviewKey(scope.userId, scope.mode), '{"version":999}');
    expect(loadListingPreview(localStorage, scope)).toBeNull();
  });
  it("renders the same price units, details and clear unpublished state", async () => {
    saveListingPreview(localStorage, scope, snapshot);
    render(<ListingPreviewClient userId="user_a" mode="private" categories={categories} regions={regions} />);
    expect(await screen.findByText("Preview — not submitted")).toBeInTheDocument();
    expect(screen.getByText("£4,500")).toBeInTheDocument();
    expect(screen.getByText("Volvo V50")).toBeInTheDocument();
    expect(screen.getByText("A tidy car")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit|pay|contact/i })).not.toBeInTheDocument();
  });
  it("fails safely when browser storage is unavailable", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      render(<ListingPreviewButton scope={scope} snapshot={snapshot} />);
      fireEvent.click(screen.getByRole("link", { name: /Preview listing/ }));
      expect(screen.getByRole("alert")).toHaveTextContent("has not been submitted");
    } finally { storage.mockRestore(); }
  });
});
