import type {
  DealerReviewDisputeStatus,
  DealerReviewModerationReason,
  DealerReviewResponseRevisionStatus,
} from "@prisma/client";

const REVIEW_REASON_COPY: Record<DealerReviewModerationReason, string> = {
  POLICY: "Policy concern",
  ABUSE: "Abusive content",
  SPAM: "Spam or manipulation",
  OFF_TOPIC: "Not about this dealership",
  OTHER: "Other",
};

export interface ManagedDealerReview {
  id: string;
  rating: number;
  comment: string | null;
  canRespond: boolean;
  createdAt: string;
  approvedResponse: { body: string; version: number } | null;
  activeRevision: {
    id: string;
    body: string;
    status: "DRAFT" | "PENDING";
    version: number;
  } | null;
  lastDecision: {
    status: "APPROVED" | "REJECTED";
    body: string;
    reason: string | null;
  } | null;
  latestDispute: {
    status: DealerReviewDisputeStatus;
    reason: string;
    decisionReason: string | null;
  } | null;
}

export function toManagedDealerReview(review: {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  response: {
    approvedBody: string | null;
    version: number;
    revisions: Array<{
      id: string;
      body: string;
      status: DealerReviewResponseRevisionStatus;
      version: number;
      reasonCode: DealerReviewModerationReason | null;
      adminNotes?: string | null;
    }>;
  } | null;
  disputes: Array<{
    status: DealerReviewDisputeStatus;
    reasonCode: DealerReviewModerationReason;
    decisionReasonCode: DealerReviewModerationReason | null;
    adminNotes?: string | null;
  }>;
}): ManagedDealerReview {
  const activeRevision = review.response?.revisions.find(
    (revision) => revision.status === "DRAFT" || revision.status === "PENDING",
  );
  const lastDecision = review.response?.revisions.find(
    (revision) =>
      revision.status === "APPROVED" || revision.status === "REJECTED",
  );
  const latestDispute = review.disputes[0] ?? null;

  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment?.trim() || null,
    canRespond: Boolean(review.comment?.trim()),
    createdAt: review.createdAt.toISOString(),
    approvedResponse: review.response?.approvedBody
      ? {
          body: review.response.approvedBody,
          version: review.response.version,
        }
      : null,
    activeRevision: activeRevision
      ? {
          id: activeRevision.id,
          body: activeRevision.body,
          status: activeRevision.status as "DRAFT" | "PENDING",
          version: activeRevision.version,
        }
      : null,
    lastDecision: lastDecision
      ? {
          status: lastDecision.status as "APPROVED" | "REJECTED",
          body: lastDecision.body,
          reason: lastDecision.reasonCode
            ? REVIEW_REASON_COPY[lastDecision.reasonCode]
            : null,
        }
      : null,
    latestDispute: latestDispute
      ? {
          status: latestDispute.status,
          reason: REVIEW_REASON_COPY[latestDispute.reasonCode],
          decisionReason: latestDispute.decisionReasonCode
            ? REVIEW_REASON_COPY[latestDispute.decisionReasonCode]
            : null,
        }
      : null,
  };
}
