import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createListing,
  payForListing,
  submitListingForReview,
  syncListingImages,
  upgradeFeatured,
} = vi.hoisted(() => ({
  createListing: vi.fn(),
  payForListing: vi.fn(),
  submitListingForReview: vi.fn(),
  syncListingImages: vi.fn(),
  upgradeFeatured: vi.fn(),
}));

vi.mock("@/actions/listings", () => ({
  createListing,
  updateListing: vi.fn(),
  syncListingImages,
  submitListingForReview,
}));

vi.mock("@/actions/payments", () => ({
  payForListing,
  upgradeFeatured,
}));

import {
  executeCreateListingSubmit,
  tryBeginSubmitFlight,
} from "@/app/(public)/sell/create-listing-submit";

function listingForm() {
  const form = new FormData();
  form.set("title", "Dealer van");
  form.set("description", "A dealer van with enough detail for the listing.");
  form.set("price", "2500");
  form.set("categoryId", "category-1");
  form.set("regionId", "region-1");
  return form;
}

describe("entitled dealer listing submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createListing.mockResolvedValue({ data: { id: "listing-1", photoRevision: 0 } });
    payForListing.mockResolvedValue({ data: { checkoutUrl: null, skippedPayment: true } });
    submitListingForReview.mockResolvedValue({ data: { id: "listing-1", status: "PENDING" } });
  });

  it("skips checkout and goes to the success page after review submission", async () => {
    const submitFlightRef = { current: false };
    const openCheckout = vi.fn();
    expect(tryBeginSubmitFlight(submitFlightRef)).toBe(true);

    const navigation = await executeCreateListingSubmit({
      form: listingForm(),
      attributes: [],
      mode: "dealer",
      skipCheckout: false,
      isEditingDraft: false,
      uploadedImages: [],
      listingIdRef: { current: null },
      photoRevisionRef: { current: 0 },
      photoMutationRef: { current: null },
      submitFlightRef,
      vehicleCatalogueSelection: { makeMode: "manual", modelMode: "manual" },
      isVehicleCatalogueCategory: false,
      selectedCategoryAttributes: [],
      createMutationId: () => "mutation-1",
      includeFeatured: false,
      listingFeeDue: false,
      onListingId: vi.fn(),
      onDraftUrl: vi.fn(),
      onPhotoRevision: vi.fn(),
      openCheckout,
    });

    expect(payForListing).toHaveBeenCalledTimes(1);
    expect(syncListingImages).not.toHaveBeenCalled();
    expect(upgradeFeatured).not.toHaveBeenCalled();
    expect(openCheckout).not.toHaveBeenCalled();
    expect(submitListingForReview).toHaveBeenCalledWith({
      listingId: "listing-1",
      privateSellerTermsAccepted: undefined,
    });
    expect(navigation).toEqual({
      kind: "success",
      href: "/sell/success?listing=listing-1&flow=dealer&payment=skipped",
    });
    expect(submitFlightRef.current).toBe(true);
    expect(tryBeginSubmitFlight(submitFlightRef)).toBe(false);
  });
});
