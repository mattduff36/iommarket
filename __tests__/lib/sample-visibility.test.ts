import { describe, expect, it } from "vitest";
import {
  applySampleDealerVisibility,
  applySampleListingVisibility,
  isHiddenSampleDealer,
  isHiddenSampleListing,
  isPlaceholderAuthUserId,
  PLACEHOLDER_AUTH_PREFIX,
  sampleDealerListingWhere,
  samplePrivateListingWhere,
} from "@/lib/listings/sample-visibility";

describe("sample listing identity", () => {
  it("keys off the seed auth prefix, not listing title or price", () => {
    expect(isPlaceholderAuthUserId(`${PLACEHOLDER_AUTH_PREFIX}201`)).toBe(true);
    expect(isPlaceholderAuthUserId("preview-system:athol-garage")).toBe(false);
    expect(isHiddenSampleListing({
      authUserId: `${PLACEHOLDER_AUTH_PREFIX}201`,
      dealerId: null,
      isAdminPreview: false,
      sampleVisibility: { privateListings: false, dealerListings: true },
    })).toBe(true);
    expect(isHiddenSampleListing({
      authUserId: `${PLACEHOLDER_AUTH_PREFIX}101`,
      dealerId: "dealer-1",
      isAdminPreview: false,
      sampleVisibility: { privateListings: true, dealerListings: false },
    })).toBe(true);
    expect(isHiddenSampleListing({
      authUserId: "preview-system:athol-garage",
      dealerId: "preview-dealer",
      isAdminPreview: true,
      sampleVisibility: { privateListings: false, dealerListings: false },
    })).toBe(false);
  });

  it("does not treat preview-pack dealers as sample dealers", () => {
    expect(
      isHiddenSampleDealer({
        authUserId: "preview-system:athol-garage",
        isAdminPreview: true,
        sampleVisibility: { privateListings: true, dealerListings: false },
      }),
    ).toBe(false);
  });
});

describe("sample visibility filters", () => {
  it("leaves queries unchanged when both sample switches are on", () => {
    const listingWhere = { status: "LIVE" as const };
    expect(
      applySampleListingVisibility(listingWhere, {
        privateListings: true,
        dealerListings: true,
      }),
    ).toEqual(listingWhere);
    expect(
      applySampleDealerVisibility({ slug: "manx-motors" }, {
        privateListings: true,
        dealerListings: true,
      }),
    ).toEqual({ slug: "manx-motors" });
  });

  it("excludes placeholder private and dealer listings independently", () => {
    expect(
      applySampleListingVisibility({ status: "LIVE" }, {
        privateListings: false,
        dealerListings: true,
      }),
    ).toEqual({
      AND: [{ status: "LIVE" }, { NOT: samplePrivateListingWhere() }],
    });
    expect(
      applySampleListingVisibility({ status: "LIVE" }, {
        privateListings: true,
        dealerListings: false,
      }),
    ).toEqual({
      AND: [{ status: "LIVE" }, { NOT: sampleDealerListingWhere() }],
    });
  });
});
