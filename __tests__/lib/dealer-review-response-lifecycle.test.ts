import { describe, expect, it, vi } from "vitest";
import { invalidateDealerReviewWorkflows } from "@/lib/reviews/dealer-response-lifecycle";

function lifecycleTx() {
  return {
    dealerReviewResponse: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    dealerReviewResponseRevision: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    dealerReviewResponseModerationEvent: { create: vi.fn() },
    dealerReviewDispute: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    dealerReviewDisputeEvent: { create: vi.fn() },
  };
}

describe("dealer review parent invalidation MD-REV-002 MD-REV-003", () => {
  it("clears public response state and deterministically closes every open slot", async () => {
    const tx = lifecycleTx();
    tx.dealerReviewResponse.findUnique.mockResolvedValue({
      id: "response-1",
      version: 7,
      approvedBody: "Previously public",
      approvedRevisionId: "approved-1",
      revisions: [
        { id: "draft-1", status: "DRAFT", version: 2 },
        { id: "pending-1", status: "PENDING", version: 4 },
      ],
    });
    tx.dealerReviewDispute.findMany.mockResolvedValue([
      { id: "dispute-1", version: 3 },
    ]);

    const result = await invalidateDealerReviewWorkflows(tx as never, {
      reviewId: "review-1",
      reviewVersion: 11,
      changedByUserId: "admin-1",
    });

    expect(tx.dealerReviewResponse.updateMany).toHaveBeenCalledWith({
      where: { id: "response-1", version: 7 },
      data: {
        approvedBody: null,
        approvedRevisionId: null,
        approvedAt: null,
        version: { increment: 1 },
      },
    });
    expect(tx.dealerReviewResponseRevision.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.dealerReviewResponseModerationEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.dealerReviewResponseModerationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: "DRAFT",
        toStatus: "REJECTED",
        responseVersion: 8,
        reviewVersion: 11,
      }),
    });
    expect(tx.dealerReviewDispute.updateMany).toHaveBeenCalledWith({
      where: { id: "dispute-1", status: "OPEN", version: 3 },
      data: expect.objectContaining({
        status: "REJECTED",
        version: { increment: 1 },
      }),
    });
    expect(tx.dealerReviewDisputeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: "OPEN",
        toStatus: "REJECTED",
        disputeVersion: 4,
        reviewVersion: 11,
      }),
    });
    expect(result).toEqual({
      responseCleared: true,
      responseVersion: 8,
      revisionsClosed: 2,
      disputesClosed: 1,
    });
  });

  it("does not mutate the parent rating while closing workflows", async () => {
    const tx = lifecycleTx();
    tx.dealerReviewResponse.findUnique.mockResolvedValue(null);
    tx.dealerReviewDispute.findMany.mockResolvedValue([]);

    await invalidateDealerReviewWorkflows(tx as never, {
      reviewId: "review-1",
      reviewVersion: 5,
    });

    expect(tx).not.toHaveProperty("dealerReview");
  });

  it("records automatic closure metadata without attributing it to the buyer", async () => {
    const tx = lifecycleTx();
    tx.dealerReviewResponse.findUnique.mockResolvedValue({
      id: "response-1",
      version: 2,
      revisions: [{ id: "draft-1", status: "DRAFT", version: 0 }],
    });
    tx.dealerReviewDispute.findMany.mockResolvedValue([
      { id: "dispute-1", version: 1 },
    ]);

    await invalidateDealerReviewWorkflows(tx as never, {
      reviewId: "review-1",
      reviewVersion: 7,
    });

    expect(tx.dealerReviewResponseRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "DRAFT", version: 0 },
      data: expect.objectContaining({
        reasonCode: "OTHER",
        adminNotes:
          "Automatically closed because the parent review is no longer approved.",
        decidedByUserId: null,
      }),
    });
    expect(tx.dealerReviewResponseModerationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reasonCode: "OTHER",
        adminNotes:
          "Automatically closed because the parent review is no longer approved.",
        changedByUserId: null,
      }),
    });
    expect(tx.dealerReviewDispute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decidedByUserId: null }),
      }),
    );
    expect(tx.dealerReviewDisputeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reasonCode: "OTHER",
        changedByUserId: null,
      }),
    });
    expect(
      JSON.stringify([
        tx.dealerReviewResponseRevision.updateMany.mock.calls,
        tx.dealerReviewResponseModerationEvent.create.mock.calls,
        tx.dealerReviewDispute.updateMany.mock.calls,
        tx.dealerReviewDisputeEvent.create.mock.calls,
      ]),
    ).not.toContain("buyer-user");
  });
});
