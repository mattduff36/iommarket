"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { reportHandledException } from "@/lib/monitoring";
import {
  moderateDealerReviewSchema,
  type ModerateDealerReviewInput,
} from "@/lib/validations/dealer-review";
import {
  DealerReviewWorkflowConflictError,
  invalidateDealerReviewWorkflows,
} from "@/lib/reviews/dealer-response-lifecycle";

class DealerReviewModerationError extends Error {}

export async function moderateDealerReviewAction(
  input: ModerateDealerReviewInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = moderateDealerReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const review = await db.$transaction(async (tx) => {
      const existing = await tx.dealerReview.findUnique({
        where: { id: parsed.data.reviewId },
        include: { dealer: { select: { slug: true } } },
      });
      if (!existing) throw new DealerReviewModerationError("Review not found");

      const moderatedAt = new Date();
      const changed = await tx.dealerReview.updateMany({
        where: {
          id: parsed.data.reviewId,
          moderationVersion: parsed.data.expectedVersion,
        },
        data: {
          status: parsed.data.status,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          moderatedAt,
          removedAt:
            parsed.data.status === "APPROVED"
              ? null
              : existing.removedAt ?? moderatedAt,
          moderationVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new DealerReviewWorkflowConflictError();
      }

      const cleanup =
        existing.status === "APPROVED" && parsed.data.status !== "APPROVED"
          ? await invalidateDealerReviewWorkflows(tx, {
              reviewId: existing.id,
              reviewVersion: parsed.data.expectedVersion + 1,
              changedByUserId: admin.id,
            })
          : null;

      await tx.dealerReviewModerationEvent.create({
        data: {
          reviewId: existing.id,
          fromStatus: existing.status,
          toStatus: parsed.data.status,
          reasonCode: parsed.data.reasonCode,
          adminNotes: parsed.data.adminNotes?.trim() || null,
          changedByUserId: admin.id,
          reviewVersion: parsed.data.expectedVersion + 1,
        },
      });

      await logAdminAction(
        {
          adminId: admin.id,
          action: "MODERATE_DEALER_REVIEW",
          entityType: "DealerReview",
          entityId: existing.id,
          details: {
            fromStatus: existing.status,
            toStatus: parsed.data.status,
            reasonCode: parsed.data.reasonCode ?? null,
            fromVersion: parsed.data.expectedVersion,
            toVersion: parsed.data.expectedVersion + 1,
            responseCleared: cleanup?.responseCleared ?? false,
            responseRevisionsClosed: cleanup?.revisionsClosed ?? 0,
            disputesClosed: cleanup?.disputesClosed ?? 0,
          },
        },
        tx,
      );

      return tx.dealerReview.findUniqueOrThrow({
        where: { id: parsed.data.reviewId },
        include: {
          dealer: { select: { slug: true } },
        },
      });
    });

    revalidatePath(`/dealers/${review.dealer.slug}`);
    revalidatePath("/admin/reviews");
    return { data: review };
  } catch (error) {
    await reportHandledException({
      error,
      action: "moderateDealerReview",
      route: "/admin/reviews",
      userId: admin.id,
    });
    return {
      error:
        error instanceof DealerReviewModerationError ||
        error instanceof DealerReviewWorkflowConflictError
          ? error.message
          : "Failed to moderate dealer review",
    };
  }
}
