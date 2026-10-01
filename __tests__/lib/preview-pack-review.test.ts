import { describe, expect, it } from "vitest";
import {
  formatPreviewReviewReason,
  listingPreviewCardProps,
  listingPreviewReviewSelect,
  previewPackVisibilitySelect,
  previewSourceHref,
  prismaModelFieldNames,
  readListingPreviewReview,
  readPreviewPackReview,
  shouldShowNoImageReviewPlaceholder,
} from "@/lib/preview-packs/review";

describe("preview pack review helpers", () => {
  it("reads forthcoming pack and listing review fields without requiring Prisma types", () => {
    expect(
      readPreviewPackReview({
        reviewRequired: true,
        reviewReasons: ["unsafe-source", ""],
        reviewSourceRunId: "  run-9  ",
      }),
    ).toEqual({
      required: true,
      reasons: ["unsafe-source"],
      sourceRunId: "run-9",
    });
    expect(
      readListingPreviewReview({
        previewReviewRequired: true,
        previewReviewReasons: ["listing-has-no-valid-source-image"],
        previewSourceIdentityKey: "stock:12",
        previewSourceUrl: "https://dealer.example/stock/12",
      }),
    ).toEqual({
      required: true,
      reasons: ["listing-has-no-valid-source-image"],
      sourceIdentityKey: "stock:12",
      sourceUrl: "https://dealer.example/stock/12",
    });
    expect(readPreviewPackReview(null)).toEqual({
      required: false,
      reasons: [],
      sourceRunId: null,
    });
    expect(
      readListingPreviewReview({
        reviewState: "NEEDS_REVIEW",
        reviewReasons: ["listing-has-no-valid-source-image"],
        reviewSourceIdentity: "stock:12",
        reviewSourceUrl: "https://dealer.example/stock/12",
      }),
    ).toEqual({
      required: true,
      reasons: ["listing-has-no-valid-source-image"],
      sourceIdentityKey: "stock:12",
      sourceUrl: "https://dealer.example/stock/12",
    });
    expect(readPreviewPackReview({ reviewState: "NONE" })).toEqual({
      required: false,
      reasons: [],
      sourceRunId: null,
    });
  });

  it("shows the no-image placeholder only when a review listing has no photo", () => {
    expect(
      shouldShowNoImageReviewPlaceholder(
        { required: true, reasons: ["price-mismatch"] },
        false,
      ),
    ).toBe(true);
    expect(
      shouldShowNoImageReviewPlaceholder(
        { required: true, reasons: ["listing-has-no-valid-source-image"] },
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowNoImageReviewPlaceholder(
        { required: true, reasons: ["price-mismatch"] },
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowNoImageReviewPlaceholder(
        { required: false, reasons: ["listing-has-no-valid-source-image"] },
        false,
      ),
    ).toBe(false);
    expect(
      listingPreviewCardProps(
        {
          previewReviewRequired: true,
          previewReviewReasons: ["listing-has-no-valid-source-image"],
        },
        false,
      ),
    ).toEqual({
      needsManualReview: true,
      noImageReview: true,
    });
  });

  it("formats reasons and only links safe http(s) source URLs", () => {
    expect(formatPreviewReviewReason("listing-has-no-valid-source-image")).toBe(
      "Listing has no valid source image",
    );
    expect(previewSourceHref("https://dealer.example/car")).toBe(
      "https://dealer.example/car",
    );
    expect(previewSourceHref("javascript:alert(1)")).toBeNull();
    expect(previewSourceHref("not a url")).toBeNull();
  });

  it("selects known Prisma review fields and ignores planned aliases until they exist", () => {
    const listingFields = prismaModelFieldNames("Listing");
    const packFields = prismaModelFieldNames("DealerPreviewPack");
    const packSelect = previewPackVisibilitySelect() as Record<string, true>;
    const listingSelect = listingPreviewReviewSelect();
    expect(packSelect).toEqual(expect.objectContaining({ enabled: true }));
    expect(packSelect.reviewRequired).toBeUndefined();
    expect(listingSelect.previewReviewRequired).toBeUndefined();
    if (packFields.has("reviewState")) {
      expect(packSelect).toEqual(
        expect.objectContaining({
          reviewState: true,
          reviewReasons: true,
          reviewSourceRunId: true,
        }),
      );
    }
    if (listingFields.has("reviewState")) {
      expect(listingSelect).toEqual(
        expect.objectContaining({
          reviewState: true,
          reviewReasons: true,
          reviewSourceIdentity: true,
          reviewSourceUrl: true,
        }),
      );
    }
  });
});
