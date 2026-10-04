import { describe, expect, it } from "vitest";
import {
  applySampleDealerVisibility,
  applySampleListingVisibility,
  applySampleUserVisibility,
  isHiddenSampleDealer,
  isHiddenSampleListing,
  isHiddenSampleUser,
  isPlaceholderAuthUserId,
  PLACEHOLDER_AUTH_PREFIX,
  sampleDealerListingWhere,
  samplePrivateListingWhere,
  sampleDealerUserWhere,
  samplePrivateUserWhere,
} from "@/lib/listings/sample-visibility";
import {
  excludePreviewPackDealersWhere,
  excludePreviewPackListingsWhere,
  excludePreviewPackUsersWhere,
} from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

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

  it("classifies private and dealer sample users independently", () => {
    expect(
      isHiddenSampleUser({
        authUserId: `${PLACEHOLDER_AUTH_PREFIX}201`,
        hasDealerProfile: false,
        sampleVisibility: { privateListings: false, dealerListings: true },
      }),
    ).toBe(true);
    expect(
      isHiddenSampleUser({
        authUserId: `${PLACEHOLDER_AUTH_PREFIX}101`,
        hasDealerProfile: true,
        sampleVisibility: { privateListings: true, dealerListings: false },
      }),
    ).toBe(true);
    expect(
      isHiddenSampleUser({
        authUserId: "preview-system:athol-garage",
        hasDealerProfile: true,
        sampleVisibility: { privateListings: false, dealerListings: false },
      }),
    ).toBe(false);
  });
});

const visibleSamples = { privateListings: true, dealerListings: true };

describe("sample visibility filters", () => {
  it("leaves queries unchanged on verified staging when both sample switches are on", () => {
    const listingWhere = { status: "LIVE" as const };
    expect(
      applySampleListingVisibility(listingWhere, visibleSamples, verifiedStagingEnv),
    ).toEqual(listingWhere);
    expect(
      applySampleDealerVisibility({ slug: "manx-motors" }, visibleSamples, verifiedStagingEnv),
    ).toEqual({ slug: "manx-motors" });
    expect(
      applySampleUserVisibility({ role: "USER" }, visibleSamples, verifiedStagingEnv),
    ).toEqual({ role: "USER" });
  });

  it("excludes preview packs from production metrics even when sample switches are on", () => {
    const listingWhere = { status: "LIVE" as const };
    expect(applySampleListingVisibility(listingWhere, visibleSamples)).toEqual({
      AND: [listingWhere, excludePreviewPackListingsWhere()],
    });
    expect(applySampleDealerVisibility({ slug: "manx-motors" }, visibleSamples)).toEqual({
      AND: [{ slug: "manx-motors" }, excludePreviewPackDealersWhere()],
    });
    expect(applySampleUserVisibility({}, visibleSamples)).toEqual(excludePreviewPackUsersWhere());
  });

  it("excludes placeholder private and dealer listings independently", () => {
    expect(
      applySampleListingVisibility({ status: "LIVE" }, {
        privateListings: false,
        dealerListings: true,
      }),
    ).toEqual({
      AND: [
        { status: "LIVE" },
        { NOT: samplePrivateListingWhere() },
        excludePreviewPackListingsWhere(),
      ],
    });
    expect(
      applySampleListingVisibility({ status: "LIVE" }, {
        privateListings: true,
        dealerListings: false,
      }),
    ).toEqual({
      AND: [
        { status: "LIVE" },
        { NOT: sampleDealerListingWhere() },
        excludePreviewPackListingsWhere(),
      ],
    });
  });

  it("excludes private and dealer sample accounts independently", () => {
    expect(
      applySampleUserVisibility({ role: "USER" }, {
        privateListings: false,
        dealerListings: true,
      }),
    ).toEqual({
      AND: [
        { role: "USER" },
        { NOT: samplePrivateUserWhere() },
        excludePreviewPackUsersWhere(),
      ],
    });
    expect(
      applySampleUserVisibility({ role: "DEALER" }, {
        privateListings: true,
        dealerListings: false,
      }),
    ).toEqual({
      AND: [
        { role: "DEALER" },
        { NOT: sampleDealerUserWhere() },
        excludePreviewPackUsersWhere(),
      ],
    });
  });
});
