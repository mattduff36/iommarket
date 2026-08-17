import { describe, expect, it } from "vitest";
import {
  decideDealerReviewDisputeSchema,
  moderateDealerReviewResponseSchema,
  openDealerReviewDisputeSchema,
  saveDealerReviewResponseDraftSchema,
} from "@/lib/validations/dealer-review";

const reviewId = "clreviewxxxxxxxxxxxxxxxxxxx";
const revisionId = "clrevisionxxxxxxxxxxxxxxxxx";
const disputeId = "cldisputexxxxxxxxxxxxxxxxxx";

describe("dealer review response validation MD-REV-001", () => {
  it("sanitizes control characters and rejects HTML UGC", () => {
    const clean = saveDealerReviewResponseDraftSchema.parse({
      reviewId,
      body: "  Thanks\u0000 for your feedback.  ",
    });
    expect(clean.body).toBe("Thanks for your feedback.");

    expect(
      saveDealerReviewResponseDraftSchema.safeParse({
        reviewId,
        body: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
  });

  it("requires CAS versions and rejection reasons", () => {
    expect(
      saveDealerReviewResponseDraftSchema.safeParse({
        reviewId,
        revisionId,
        body: "Updated response",
      }).success,
    ).toBe(false);

    expect(
      moderateDealerReviewResponseSchema.safeParse({
        revisionId,
        expectedVersion: 1,
        expectedResponseVersion: 2,
        decision: "REJECTED",
      }).success,
    ).toBe(false);
  });

  it("validates dispute detail and versioned decisions", () => {
    expect(
      openDealerReviewDisputeSchema.safeParse({
        reviewId,
        reasonCode: "OFF_TOPIC",
        body: "Too short",
      }).success,
    ).toBe(false);

    expect(
      decideDealerReviewDisputeSchema.safeParse({
        disputeId,
        expectedVersion: 0,
        decision: "RESOLVED",
        reasonCode: "POLICY",
      }).success,
    ).toBe(true);
  });
});
