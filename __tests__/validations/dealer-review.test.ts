import { describe, it, expect } from "vitest";
import {
  createDealerReviewSchema,
  moderateDealerReviewSchema,
} from "@/lib/validations/dealer-review";

describe("createDealerReviewSchema", () => {
  it("accepts valid rating with optional comment", () => {
    const result = createDealerReviewSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      rating: 5,
      comment: "Great communication and very professional service.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects ratings outside range", () => {
    const result = createDealerReviewSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      rating: 6,
    });
    expect(result.success).toBe(false);
  });

  it("sanitizes plain text and rejects HTML in original review comments", () => {
    const sanitized = createDealerReviewSchema.parse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      rating: 5,
      comment: "  Helpful\u0000 review  ",
    });
    expect(sanitized.comment).toBe("Helpful review");

    const html = createDealerReviewSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      rating: 5,
      comment: "<strong>Promoted review</strong>",
    });
    expect(html.success).toBe(false);
  });
});

describe("moderateDealerReviewSchema", () => {
  it("accepts review moderation updates", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 0,
      status: "APPROVED",
      adminNotes: "Looks legitimate.",
    });
    expect(result.success).toBe(true);
  });

  it("requires a reason when rejecting a review ALR-REV-001", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 0,
      status: "REJECTED",
    });
    expect(result.success).toBe(false);
  });

  it("requires a reason when returning a review to pending ALR-REV-001", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 0,
      status: "PENDING",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported status values", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedVersion: 0,
      status: "OPEN",
    });
    expect(result.success).toBe(false);
  });
});
