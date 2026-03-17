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
});

describe("moderateDealerReviewSchema", () => {
  it("accepts review moderation updates", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "APPROVED",
      adminNotes: "Looks legitimate.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported status values", () => {
    const result = moderateDealerReviewSchema.safeParse({
      reviewId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      status: "OPEN",
    });
    expect(result.success).toBe(false);
  });
});
