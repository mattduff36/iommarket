"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { getOrCreateReviewDeviceId } from "@/lib/reviews/device-cookie";
import {
  createDealerReviewSchema,
  decideDealerReviewDisputeSchema,
  moderateDealerReviewResponseSchema,
  openDealerReviewDisputeSchema,
  saveDealerReviewResponseDraftSchema,
  submitDealerReviewResponseSchema,
  type CreateDealerReviewInput,
  type DecideDealerReviewDisputeInput,
  type ModerateDealerReviewResponseInput,
  type ModerateDealerReviewInput,
  type OpenDealerReviewDisputeInput,
  type SaveDealerReviewResponseDraftInput,
  type SubmitDealerReviewResponseInput,
} from "@/lib/validations/dealer-review";
import { reportHandledException } from "@/lib/monitoring";
import { logAdminAction } from "@/lib/admin/audit";
import { dispatchDealerReviewNotifications } from "@/lib/email/dealer-review-notifications";
import { invalidateDealerReviewWorkflows } from "@/lib/reviews/dealer-response-lifecycle";
import { dealerReviewRateAllowed as reviewRateAllowed } from "@/lib/reviews/dealer-review-rate-limit";
import { moderateDealerReviewAction } from "@/actions/admin/dealer-review-moderation";

type DbClient = Prisma.TransactionClient | typeof db;

class DealerReviewActionError extends Error {}

class DealerReviewConflictError extends DealerReviewActionError {
  constructor() {
    super("This review workflow changed. Refresh and try again.");
    this.name = "DealerReviewConflictError";
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function assertResponseEligibility(review: {
  status: string;
  comment: string | null;
}) {
  if (review.status !== "APPROVED") {
    throw new DealerReviewActionError(
      "Only approved reviews can receive a dealer response.",
    );
  }
  if (!review.comment?.trim()) {
    throw new DealerReviewActionError(
      "A dealer response requires an approved written review.",
    );
  }
}

async function getOwnedReview(
  client: DbClient,
  reviewId: string,
  userId: string,
) {
  const review = await client.dealerReview.findUnique({
    where: { id: reviewId },
    include: {
      dealer: { select: { id: true, slug: true, userId: true } },
    },
  });
  if (!review) throw new DealerReviewActionError("Review not found");
  if (review.dealer.userId !== userId) {
    throw new DealerReviewActionError("Not authorized for this dealer review.");
  }
  return review;
}

function actionError(error: unknown, fallback: string) {
  return error instanceof DealerReviewActionError ? error.message : fallback;
}

export async function submitDealerReview(input: CreateDealerReviewInput) {
  const parsed = createDealerReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const currentUser = await getCurrentUser();
  if (currentUser?.disabledAt) {
    return { error: "Your account is currently disabled." };
  }

  const deviceId = currentUser ? null : await getOrCreateReviewDeviceId();
  const actor = currentUser ? `user:${currentUser.id}` : `device:${deviceId}`;
  if (
    !reviewRateAllowed({
      action: "submit",
      actor,
      target: parsed.data.dealerId,
    })
  ) {
    return { error: "Too many review updates. Please wait and try again." };
  }

  const dealer = await db.dealerProfile.findUnique({
    where: { id: parsed.data.dealerId },
    select: { id: true, slug: true },
  });
  if (!dealer) return { error: "Dealer not found" };

  try {
    const comment = parsed.data.comment || null;

    if (currentUser) {
      const review = await db.$transaction(async (tx) => {
        const existing = await tx.dealerReview.findUnique({
          where: {
            dealerId_reviewerUserId: {
              dealerId: dealer.id,
              reviewerUserId: currentUser.id,
            },
          },
        });
        if (!existing) {
          return tx.dealerReview.create({
            data: {
              dealerId: dealer.id,
              reviewerUserId: currentUser.id,
              reviewerType: "REGISTERED",
              reviewerName: currentUser.name?.trim() || null,
              rating: parsed.data.rating,
              comment,
            },
          });
        }

        const nextVersion = existing.moderationVersion + 1;
        const changed = await tx.dealerReview.updateMany({
          where: {
            id: existing.id,
            moderationVersion: existing.moderationVersion,
          },
          data: {
            rating: parsed.data.rating,
            comment,
            reviewerType: "REGISTERED",
            reviewerName: currentUser.name?.trim() || null,
            reviewerDeviceId: null,
            status: "PENDING",
            moderatedAt: null,
            removedAt:
              existing.status === "APPROVED"
                ? new Date()
                : existing.removedAt,
            moderationVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new DealerReviewConflictError();

        if (existing.status === "APPROVED") {
          await invalidateDealerReviewWorkflows(tx, {
            reviewId: existing.id,
            reviewVersion: nextVersion,
            changedByUserId: null,
          });
        }
        await tx.dealerReviewModerationEvent.create({
          data: {
            reviewId: existing.id,
            fromStatus: existing.status,
            toStatus: "PENDING",
            reasonCode: "OTHER",
            changedByUserId: currentUser.id,
            reviewVersion: nextVersion,
          },
        });
        return tx.dealerReview.findUniqueOrThrow({
          where: { id: existing.id },
        });
      });
      revalidatePath(`/dealers/${dealer.slug}`);
      revalidatePath("/admin/reviews");
      return { data: review };
    }

    if (comment) {
      return {
        error: "Sign in to add a written comment. Anonymous reviews can submit a star rating only.",
      };
    }

    const review = await db.$transaction(async (tx) => {
      const existing = await tx.dealerReview.findUnique({
        where: {
          dealerId_reviewerDeviceId: {
            dealerId: dealer.id,
            reviewerDeviceId: deviceId!,
          },
        },
      });
      if (!existing) {
        return tx.dealerReview.create({
          data: {
            dealerId: dealer.id,
            reviewerDeviceId: deviceId!,
            reviewerType: "ANONYMOUS",
            rating: parsed.data.rating,
          },
        });
      }

      const nextVersion = existing.moderationVersion + 1;
      const changed = await tx.dealerReview.updateMany({
        where: {
          id: existing.id,
          moderationVersion: existing.moderationVersion,
        },
        data: {
          rating: parsed.data.rating,
          reviewerType: "ANONYMOUS",
          reviewerUserId: null,
          reviewerName: null,
          comment: null,
          status: "PENDING",
          moderatedAt: null,
          removedAt:
            existing.status === "APPROVED" ? new Date() : existing.removedAt,
          moderationVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new DealerReviewConflictError();

      if (existing.status === "APPROVED") {
        await invalidateDealerReviewWorkflows(tx, {
          reviewId: existing.id,
          reviewVersion: nextVersion,
        });
      }
      await tx.dealerReviewModerationEvent.create({
        data: {
          reviewId: existing.id,
          fromStatus: existing.status,
          toStatus: "PENDING",
          reasonCode: "OTHER",
          reviewVersion: nextVersion,
        },
      });
      return tx.dealerReview.findUniqueOrThrow({
        where: { id: existing.id },
      });
    });

    revalidatePath(`/dealers/${dealer.slug}`);
    revalidatePath("/admin/reviews");
    return { data: review };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "submitDealerReview",
      route: "/dealers",
    });
    return { error: actionError(err, "Failed to submit dealer review") };
  }
}

export async function moderateDealerReview(input: ModerateDealerReviewInput) {
  return moderateDealerReviewAction(input);
}

export async function saveDealerReviewResponseDraft(
  input: SaveDealerReviewResponseDraftInput,
) {
  const parsed = saveDealerReviewResponseDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const user = await requireAcceptedAuth();
  if (
    !reviewRateAllowed({
      action: "draft",
      actor: `user:${user.id}`,
      target: parsed.data.reviewId,
    })
  ) {
    return { error: "Too many response saves. Please wait and try again." };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const review = await getOwnedReview(tx, parsed.data.reviewId, user.id);
      assertResponseEligibility(review);

      const response = await tx.dealerReviewResponse.upsert({
        where: { reviewId: review.id },
        update: {},
        create: { reviewId: review.id },
      });

      if (parsed.data.revisionId) {
        const changed = await tx.dealerReviewResponseRevision.updateMany({
          where: {
            id: parsed.data.revisionId,
            responseId: response.id,
            status: "DRAFT",
            version: parsed.data.expectedVersion,
          },
          data: {
            body: parsed.data.body,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new DealerReviewConflictError();
        return {
          revision: await tx.dealerReviewResponseRevision.findUniqueOrThrow({
            where: { id: parsed.data.revisionId },
          }),
          conflict: false as const,
        };
      }

      const concurrent = await tx.dealerReviewResponseRevision.findFirst({
        where: {
          responseId: response.id,
          status: { in: ["DRAFT", "PENDING"] },
        },
      });
      if (concurrent) {
        if (concurrent.status === "PENDING") {
          throw new DealerReviewActionError(
            "This response is already awaiting moderation.",
          );
        }
        return { revision: concurrent, conflict: true as const };
      }

      return {
        revision: await tx.dealerReviewResponseRevision.create({
          data: {
            responseId: response.id,
            body: parsed.data.body,
            status: "DRAFT",
          },
        }),
        conflict: false as const,
      };
    });

    revalidatePath("/dealer/dashboard");
    return {
      data: result.revision,
      ...(result.conflict ? { conflict: true as const } : {}),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await db.dealerReviewResponseRevision.findFirst({
        where: {
          response: {
            reviewId: parsed.data.reviewId,
            review: { dealer: { userId: user.id } },
          },
          status: { in: ["DRAFT", "PENDING"] },
        },
      });
      if (winner) return { data: winner, conflict: true as const };
    }
    await reportHandledException({
      error,
      action: "saveDealerReviewResponseDraft",
      route: "/dealer/dashboard",
      userId: user.id,
    });
    return { error: actionError(error, "Failed to save dealer response") };
  }
}

export async function submitDealerReviewResponse(
  input: SubmitDealerReviewResponseInput,
) {
  const parsed = submitDealerReviewResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const user = await requireAcceptedAuth();
  if (
    !reviewRateAllowed({
      action: "response-submit",
      actor: `user:${user.id}`,
      target: parsed.data.reviewId,
    })
  ) {
    return { error: "Too many response submissions. Please wait and try again." };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const revision = await tx.dealerReviewResponseRevision.findUnique({
        where: { id: parsed.data.revisionId },
        include: {
          response: {
            include: {
              review: {
                include: {
                  dealer: { select: { userId: true, slug: true } },
                },
              },
            },
          },
        },
      });
      if (!revision) {
        throw new DealerReviewActionError("Response revision not found");
      }
      if (revision.response.review.dealer.userId !== user.id) {
        throw new DealerReviewActionError(
          "Not authorized for this dealer response.",
        );
      }
      if (revision.response.review.id !== parsed.data.reviewId) {
        throw new DealerReviewActionError("Response revision not found");
      }
      assertResponseEligibility(revision.response.review);

      const changed = await tx.dealerReviewResponseRevision.updateMany({
        where: {
          id: revision.id,
          status: "DRAFT",
          version: parsed.data.expectedVersion,
        },
        data: {
          status: "PENDING",
          submittedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new DealerReviewConflictError();

      await tx.dealerReviewResponseModerationEvent.create({
        data: {
          revisionId: revision.id,
          fromStatus: "DRAFT",
          toStatus: "PENDING",
          revisionVersion: parsed.data.expectedVersion + 1,
          responseVersion: revision.response.version,
          reviewVersion: revision.response.review.moderationVersion,
          changedByUserId: user.id,
        },
      });
      return {
        revision: await tx.dealerReviewResponseRevision.findUniqueOrThrow({
          where: { id: revision.id },
        }),
        dealerSlug: revision.response.review.dealer.slug,
      };
    });

    await dispatchDealerReviewNotifications([
      { kind: "RESPONSE_SUBMITTED", revisionId: result.revision.id },
    ]);
    revalidatePath("/dealer/dashboard");
    revalidatePath("/admin/reviews");
    revalidatePath(`/dealers/${result.dealerSlug}`);
    return { data: result.revision };
  } catch (error) {
    await reportHandledException({
      error,
      action: "submitDealerReviewResponse",
      route: "/dealer/dashboard",
      userId: user.id,
    });
    return { error: actionError(error, "Failed to submit dealer response") };
  }
}

export async function moderateDealerReviewResponse(
  input: ModerateDealerReviewResponseInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = moderateDealerReviewResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const revision = await tx.dealerReviewResponseRevision.findUnique({
        where: { id: parsed.data.revisionId },
        include: {
          response: {
            include: {
              review: {
                include: { dealer: { select: { slug: true } } },
              },
            },
          },
        },
      });
      if (!revision) {
        throw new DealerReviewActionError("Response revision not found");
      }
      if (parsed.data.decision === "APPROVED") {
        assertResponseEligibility(revision.response.review);
      }
      if (revision.response.version !== parsed.data.expectedResponseVersion) {
        throw new DealerReviewConflictError();
      }

      const decidedAt = new Date();
      const changed = await tx.dealerReviewResponseRevision.updateMany({
        where: {
          id: revision.id,
          status: "PENDING",
          version: parsed.data.expectedVersion,
        },
        data: {
          status: parsed.data.decision,
          reasonCode:
            parsed.data.decision === "REJECTED"
              ? parsed.data.reasonCode
              : null,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          decidedAt,
          decidedByUserId: admin.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new DealerReviewConflictError();

      const responseChanged = await tx.dealerReviewResponse.updateMany({
        where: {
          id: revision.responseId,
          version: parsed.data.expectedResponseVersion,
        },
        data:
          parsed.data.decision === "APPROVED"
            ? {
                approvedBody: revision.body,
                approvedRevisionId: revision.id,
                approvedAt: decidedAt,
                version: { increment: 1 },
              }
            : revision.response.review.status === "APPROVED"
              ? { version: { increment: 1 } }
              : {
                  approvedBody: null,
                  approvedRevisionId: null,
                  approvedAt: null,
                  version: { increment: 1 },
                },
      });
      if (responseChanged.count !== 1) throw new DealerReviewConflictError();

      await tx.dealerReviewResponseModerationEvent.create({
        data: {
          revisionId: revision.id,
          fromStatus: "PENDING",
          toStatus: parsed.data.decision,
          reasonCode:
            parsed.data.decision === "REJECTED"
              ? parsed.data.reasonCode
              : null,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          revisionVersion: parsed.data.expectedVersion + 1,
          responseVersion: parsed.data.expectedResponseVersion + 1,
          reviewVersion: revision.response.review.moderationVersion,
          changedByUserId: admin.id,
        },
      });

      await logAdminAction(
        {
          adminId: admin.id,
          action: `DEALER_RESPONSE_${parsed.data.decision}`,
          entityType: "DealerReviewResponseRevision",
          entityId: revision.id,
          details: {
            reviewId: revision.response.reviewId,
            responseId: revision.responseId,
            reasonCode: parsed.data.reasonCode ?? null,
            fromRevisionVersion: parsed.data.expectedVersion,
            toRevisionVersion: parsed.data.expectedVersion + 1,
            fromResponseVersion: parsed.data.expectedResponseVersion,
            toResponseVersion: parsed.data.expectedResponseVersion + 1,
            reviewVersion: revision.response.review.moderationVersion,
            parentReviewStatus: revision.response.review.status,
          },
        },
        tx,
      );

      return {
        revision: await tx.dealerReviewResponseRevision.findUniqueOrThrow({
          where: { id: revision.id },
        }),
        dealerSlug: revision.response.review.dealer.slug,
      };
    });

    await dispatchDealerReviewNotifications([
      { kind: "RESPONSE_DECIDED", revisionId: result.revision.id },
    ]);
    revalidatePath("/admin/reviews");
    revalidatePath("/dealer/dashboard");
    revalidatePath(`/dealers/${result.dealerSlug}`);
    return { data: result.revision };
  } catch (error) {
    await reportHandledException({
      error,
      action: "moderateDealerReviewResponse",
      route: "/admin/reviews",
      userId: admin.id,
    });
    return { error: actionError(error, "Failed to moderate dealer response") };
  }
}

export async function openDealerReviewDispute(
  input: OpenDealerReviewDisputeInput,
) {
  const parsed = openDealerReviewDisputeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const user = await requireAcceptedAuth();
  if (
    !reviewRateAllowed({
      action: "dispute",
      actor: `user:${user.id}`,
      target: parsed.data.reviewId,
    })
  ) {
    return { error: "Too many dispute requests. Please wait and try again." };
  }

  try {
    const dispute = await db.$transaction(async (tx) => {
      const review = await getOwnedReview(tx, parsed.data.reviewId, user.id);
      if (review.status !== "APPROVED") {
        throw new DealerReviewActionError(
          "Only approved reviews can be disputed.",
        );
      }
      const existing = await tx.dealerReviewDispute.findFirst({
        where: { reviewId: review.id, status: "OPEN" },
      });
      if (existing) return { dispute: existing, created: false as const };
      const created = await tx.dealerReviewDispute.create({
        data: {
          reviewId: review.id,
          openedByUserId: user.id,
          reasonCode: parsed.data.reasonCode,
          body: parsed.data.body,
          evidenceMetadata: parsed.data.evidenceNotes
            ? { notes: parsed.data.evidenceNotes }
            : undefined,
        },
      });
      return { dispute: created, created: true as const };
    });

    if (dispute.created) {
      await dispatchDealerReviewNotifications([
        { kind: "DISPUTE_OPENED", disputeId: dispute.dispute.id },
      ]);
    }
    revalidatePath("/dealer/dashboard");
    revalidatePath("/admin/reviews");
    return { data: dispute.dispute };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await db.dealerReviewDispute.findFirst({
        where: {
          reviewId: parsed.data.reviewId,
          status: "OPEN",
          review: { dealer: { userId: user.id } },
        },
      });
      if (winner) return { data: winner, conflict: true as const };
    }
    await reportHandledException({
      error,
      action: "openDealerReviewDispute",
      route: "/dealer/dashboard",
      userId: user.id,
    });
    return { error: actionError(error, "Failed to open review dispute") };
  }
}

export async function decideDealerReviewDispute(
  input: DecideDealerReviewDisputeInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = decideDealerReviewDisputeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const dispute = await tx.dealerReviewDispute.findUnique({
        where: { id: parsed.data.disputeId },
        include: {
          review: { include: { dealer: { select: { slug: true } } } },
        },
      });
      if (!dispute) {
        throw new DealerReviewActionError("Review dispute not found");
      }

      const changed = await tx.dealerReviewDispute.updateMany({
        where: {
          id: dispute.id,
          status: "OPEN",
          version: parsed.data.expectedVersion,
        },
        data: {
          status: parsed.data.decision,
          decisionReasonCode: parsed.data.reasonCode,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          decidedAt: new Date(),
          decidedByUserId: admin.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new DealerReviewConflictError();

      await tx.dealerReviewDisputeEvent.create({
        data: {
          disputeId: dispute.id,
          fromStatus: "OPEN",
          toStatus: parsed.data.decision,
          reasonCode: parsed.data.reasonCode,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          disputeVersion: parsed.data.expectedVersion + 1,
          reviewVersion: dispute.review.moderationVersion,
          changedByUserId: admin.id,
        },
      });

      await logAdminAction(
        {
          adminId: admin.id,
          action: `DEALER_REVIEW_DISPUTE_${parsed.data.decision}`,
          entityType: "DealerReviewDispute",
          entityId: dispute.id,
          details: {
            reviewId: dispute.reviewId,
            reasonCode: parsed.data.reasonCode,
            fromVersion: parsed.data.expectedVersion,
            toVersion: parsed.data.expectedVersion + 1,
            reviewVersion: dispute.review.moderationVersion,
          },
        },
        tx,
      );
      return {
        dispute: await tx.dealerReviewDispute.findUniqueOrThrow({
          where: { id: dispute.id },
        }),
        dealerSlug: dispute.review.dealer.slug,
      };
    });

    await dispatchDealerReviewNotifications([
      { kind: "DISPUTE_DECIDED", disputeId: result.dispute.id },
    ]);
    revalidatePath("/admin/reviews");
    revalidatePath("/dealer/dashboard");
    revalidatePath(`/dealers/${result.dealerSlug}`);
    return { data: result.dispute };
  } catch (error) {
    await reportHandledException({
      error,
      action: "decideDealerReviewDispute",
      route: "/admin/reviews",
      userId: admin.id,
    });
    return { error: actionError(error, "Failed to decide review dispute") };
  }
}
