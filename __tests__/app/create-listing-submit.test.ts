import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createListing,
  payForListing,
  submitListingForReview,
  syncListingImages,
  updateListing,
  upgradeFeatured,
} = vi.hoisted(() => ({
  createListing: vi.fn(),
  payForListing: vi.fn(),
  submitListingForReview: vi.fn(),
  syncListingImages: vi.fn(),
  updateListing: vi.fn(),
  upgradeFeatured: vi.fn(),
}));

vi.mock("@/actions/listings", () => ({
  createListing,
  updateListing,
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

  it("opens the optional step for an invalid optional field and does not offer a raw checkout retry", async () => {
    updateListing.mockResolvedValue({
      error: { "attr-engine": ["Enter a whole number of cc."] },
    });
    const navigation = await executeCreateListingSubmit({
      form: listingForm(),
      attributes: [],
      mode: "private",
      skipCheckout: false,
      isEditingDraft: true,
      uploadedImages: [],
      listingIdRef: { current: "listing-1" },
      photoRevisionRef: { current: 1 },
      photoMutationRef: { current: null },
      submitFlightRef: { current: true },
      vehicleCatalogueSelection: { makeMode: "manual", modelMode: "manual" },
      isVehicleCatalogueCategory: false,
      selectedCategoryAttributes: [],
      attributeSteps: { "attr-engine": 2 },
      createMutationId: () => "mutation-1",
      onListingId: vi.fn(),
      onDraftUrl: vi.fn(),
      onPhotoRevision: vi.fn(),
      openCheckout: vi.fn(),
    });
    expect(navigation).toMatchObject({
      kind: "stay",
      step: 2,
      fieldErrors: { "attr-engine": ["Enter a whole number of cc."] },
    });

    payForListing.mockResolvedValue({
      error: "postgres unique violation https://pay.example/tok_secret",
      code: "unknown",
      retryable: false,
    });
    updateListing.mockResolvedValue({ data: { id: "listing-1" } });
    const checkout = await executeCreateListingSubmit({
      form: listingForm(),
      attributes: [],
      mode: "private",
      skipCheckout: false,
      isEditingDraft: false,
      uploadedImages: [],
      listingIdRef: { current: "listing-1" },
      photoRevisionRef: { current: 1 },
      photoMutationRef: { current: null },
      submitFlightRef: { current: true },
      vehicleCatalogueSelection: { makeMode: "manual", modelMode: "manual" },
      isVehicleCatalogueCategory: false,
      selectedCategoryAttributes: [],
      createMutationId: () => "mutation-1",
      onListingId: vi.fn(),
      onDraftUrl: vi.fn(),
      onPhotoRevision: vi.fn(),
      openCheckout: vi.fn(),
    });
    expect(checkout).toMatchObject({ kind: "stay" });
    if (checkout.kind !== "stay") throw new Error("expected to stay");
    expect(checkout.error).toBe("We couldn't confirm that this request finished. Check the result before trying again.");
    expect(checkout.error).not.toMatch(/tok_secret|https:|not charged/i);
  });

  it.each(["response", "transport"])("locks an uncertain new listing %s without losing form values", async (kind) => {
    if (kind === "transport") createListing.mockRejectedValueOnce(new Error("private database message"));
    else createListing.mockResolvedValueOnce({ error: "Check the listing before retrying.", code: "unknown", retryable: false });
    const form = listingForm();
    const flight = { current: true };
    const result = await executeCreateListingSubmit({
      form, attributes: [], mode: "private", skipCheckout: false, isEditingDraft: false,
      uploadedImages: [], listingIdRef: { current: null }, photoRevisionRef: { current: 0 }, photoMutationRef: { current: null }, submitFlightRef: flight,
      vehicleCatalogueSelection: { makeMode: "manual", modelMode: "manual" }, isVehicleCatalogueCategory: false, selectedCategoryAttributes: [],
      createMutationId: () => "test", onListingId: vi.fn(), onDraftUrl: vi.fn(), onPhotoRevision: vi.fn(), openCheckout: vi.fn(),
    });
    expect(result).toMatchObject({ kind: "stay", uncertain: true, reviewHref: "/account/listings" });
    expect(tryBeginSubmitFlight(flight)).toBe(false);
    expect(form.get("title")).toBe("Dealer van");
    expect(payForListing).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private database message");
  });

});
