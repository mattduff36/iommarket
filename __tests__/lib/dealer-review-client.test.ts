import { describe, expect, it } from "vitest";
import { toManagedDealerReview } from "@/lib/reviews/dealer-review-client";

describe("dealer review dashboard client projection", () => {
  it("serializes dealer-visible status and reason copy without admin notes", () => {
    const projected = toManagedDealerReview({
      id: "review-1",
      rating: 4,
      comment: "Useful review",
      createdAt: new Date("2026-08-17T00:00:00.000Z"),
      response: {
        approvedBody: null,
        version: 3,
        revisions: [
          {
            id: "revision-1",
            body: "Dealer response",
            status: "REJECTED",
            version: 2,
            reasonCode: "SPAM",
            adminNotes: "Internal investigation details",
          },
        ],
      },
      disputes: [
        {
          status: "REJECTED",
          reasonCode: "OFF_TOPIC",
          decisionReasonCode: "POLICY",
          adminNotes: "Private moderator notes",
        },
      ],
    });

    expect(projected.lastDecision?.reason).toBe("Spam or manipulation");
    expect(projected.latestDispute?.decisionReason).toBe("Policy concern");
    expect(JSON.stringify(projected)).not.toContain("adminNotes");
    expect(JSON.stringify(projected)).not.toContain("Internal investigation");
    expect(JSON.stringify(projected)).not.toContain("Private moderator");
  });
});
