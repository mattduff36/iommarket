import { describe, expect, it } from "vitest";
import {
  applySampleDealerReviewVisibility,
  applySamplePaymentVisibility,
  applySampleSubscriptionVisibility,
} from "@/lib/listings/sample-related-visibility";
import {
  applySampleDealerVisibility,
  applySampleListingVisibility,
  applySampleUserVisibility,
} from "@/lib/listings/sample-visibility";
import { excludePreviewPackDealersWhere } from "@/lib/preview-packs/frontend-visibility";
import { verifiedStagingEnv } from "./verified-staging-env";

const hidden = {
  privateListings: false,
  dealerListings: false,
};

describe("related sample data visibility", () => {
  it("filters listing payments through the same listing visibility policy", () => {
    expect(
      applySamplePaymentVisibility({ status: "SUCCEEDED" }, hidden),
    ).toEqual({
      AND: [
        { status: "SUCCEEDED" },
        { listing: applySampleListingVisibility({}, hidden) },
      ],
    });
  });

  it("filters subscriptions through the sample dealer policy", () => {
    expect(
      applySampleSubscriptionVisibility({ status: "ACTIVE" }, hidden),
    ).toEqual({
      AND: [
        { status: "ACTIVE" },
        { dealer: applySampleDealerVisibility({}, hidden) },
      ],
    });
  });

  it("excludes preview dealers from production subscription metrics when samples are visible", () => {
    const visible = { privateListings: true, dealerListings: true };
    expect(applySampleSubscriptionVisibility({ status: "ACTIVE" }, visible)).toEqual({
      AND: [
        { status: "ACTIVE" },
        { dealer: excludePreviewPackDealersWhere() },
      ],
    });
    expect(
      applySampleSubscriptionVisibility({ status: "ACTIVE" }, visible, verifiedStagingEnv),
    ).toEqual({ status: "ACTIVE" });
  });

  it("keeps anonymous real-dealer reviews while hiding sample accounts", () => {
    expect(
      applySampleDealerReviewVisibility({ status: "PENDING" }, hidden),
    ).toEqual({
      AND: [
        { status: "PENDING" },
        { dealer: applySampleDealerVisibility({}, hidden) },
        {
          OR: [
            { reviewerUserId: null },
            { reviewer: applySampleUserVisibility({}, hidden) },
          ],
        },
      ],
    });
  });
});
