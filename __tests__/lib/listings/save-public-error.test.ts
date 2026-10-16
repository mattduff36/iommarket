import { describe, expect, it } from "vitest";
import { ListingLifecycleError } from "@/lib/listings/errors";
import {
  LISTING_SAVE_UNKNOWN,
  LISTING_UNAVAILABLE,
  listingAuthBody,
  listingDomainResult,
} from "@/lib/listings/save-public-error";
import {
  focusIdForFieldErrors,
  guidedStepForFieldErrors,
  optionalSectionForAttribute,
} from "@/lib/listings/guided-listing-workflow";

describe("listing save public errors", () => {
  it("keeps an allowlisted lifecycle sentence and hides a database sentence", () => {
    expect(listingDomainResult(
      new ListingLifecycleError("Payment is required to renew an expired listing."),
      "unused",
    )).toEqual({ error: "Payment is required to renew an expired listing." });
    expect(listingDomainResult(
      new ListingLifecycleError("Listing not found"),
      "unused",
    )).toEqual({ error: LISTING_UNAVAILABLE });
    expect(listingDomainResult(
      new ListingLifecycleError("duplicate key value violates unique constraint https://db.example/secret"),
      "unused",
    )).toBeNull();
    expect(LISTING_SAVE_UNKNOWN).not.toMatch(/saved successfully|were not saved/i);
  });

  it("maps an expired sign-in to a safe listing action", () => {
    const error = new Error("session expired token=abc");
    error.name = "AuthenticationRequiredError";
    expect(listingAuthBody(error)).toMatchObject({
      error: "Sign in again to save this listing.",
      code: "unauthorized",
      retryable: false,
    });
  });

  it("opens the optional group for an invalid optional field", () => {
    const fieldErrors = { "attr-engine": ["Enter a whole number of cc."] };
    const step = guidedStepForFieldErrors(fieldErrors, {
      attributeSteps: { "attr-engine": 2 },
      fallback: 1,
    });
    expect(step).toBe(2);
    expect(focusIdForFieldErrors(fieldErrors)).toBe("attr-engine");
    expect(optionalSectionForAttribute([
      { id: "powertrain", items: [{ attr: { id: "engine" } }] },
    ], "engine")).toBe("powertrain");
  });
});
