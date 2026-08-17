import type { Prisma } from "@prisma/client";

const INVALIDATION_NOTES =
  "Automatically closed because the parent review is no longer approved.";

export class DealerReviewWorkflowConflictError extends Error {
  constructor() {
    super("This review workflow changed. Refresh and try again.");
    this.name = "DealerReviewWorkflowConflictError";
  }
}

export async function invalidateDealerReviewWorkflows(
  tx: Prisma.TransactionClient,
  input: {
    reviewId: string;
    reviewVersion: number;
    changedByUserId?: string | null;
  },
) {
  const decidedAt = new Date();
  const response = await tx.dealerReviewResponse.findUnique({
    where: { reviewId: input.reviewId },
    include: {
      revisions: {
        where: { status: { in: ["DRAFT", "PENDING"] } },
        select: { id: true, status: true, version: true },
      },
    },
  });

  let responseVersion: number | null = null;
  if (response) {
    const cleared = await tx.dealerReviewResponse.updateMany({
      where: { id: response.id, version: response.version },
      data: {
        approvedBody: null,
        approvedRevisionId: null,
        approvedAt: null,
        version: { increment: 1 },
      },
    });
    if (cleared.count !== 1) {
      throw new DealerReviewWorkflowConflictError();
    }
    responseVersion = response.version + 1;

    for (const revision of response.revisions) {
      const rejected = await tx.dealerReviewResponseRevision.updateMany({
        where: {
          id: revision.id,
          status: revision.status,
          version: revision.version,
        },
        data: {
          status: "REJECTED",
          reasonCode: "OTHER",
          adminNotes: INVALIDATION_NOTES,
          decidedAt,
          decidedByUserId: input.changedByUserId ?? null,
          version: { increment: 1 },
        },
      });
      if (rejected.count !== 1) {
        throw new DealerReviewWorkflowConflictError();
      }
      await tx.dealerReviewResponseModerationEvent.create({
        data: {
          revisionId: revision.id,
          fromStatus: revision.status,
          toStatus: "REJECTED",
          reasonCode: "OTHER",
          adminNotes: INVALIDATION_NOTES,
          revisionVersion: revision.version + 1,
          responseVersion,
          reviewVersion: input.reviewVersion,
          changedByUserId: input.changedByUserId ?? null,
        },
      });
    }
  }

  const disputes = await tx.dealerReviewDispute.findMany({
    where: { reviewId: input.reviewId, status: "OPEN" },
    select: { id: true, version: true },
  });
  for (const dispute of disputes) {
    const closed = await tx.dealerReviewDispute.updateMany({
      where: { id: dispute.id, status: "OPEN", version: dispute.version },
      data: {
        status: "REJECTED",
        decisionReasonCode: "OTHER",
        adminNotes: INVALIDATION_NOTES,
        decidedAt,
        decidedByUserId: input.changedByUserId ?? null,
        version: { increment: 1 },
      },
    });
    if (closed.count !== 1) {
      throw new DealerReviewWorkflowConflictError();
    }
    await tx.dealerReviewDisputeEvent.create({
      data: {
        disputeId: dispute.id,
        fromStatus: "OPEN",
        toStatus: "REJECTED",
        reasonCode: "OTHER",
        adminNotes: INVALIDATION_NOTES,
        disputeVersion: dispute.version + 1,
        reviewVersion: input.reviewVersion,
        changedByUserId: input.changedByUserId ?? null,
      },
    });
  }

  return {
    responseCleared: Boolean(response),
    responseVersion,
    revisionsClosed: response?.revisions.length ?? 0,
    disputesClosed: disputes.length,
  };
}
