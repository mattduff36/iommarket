"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { getOrCreateReviewDeviceId } from "@/lib/reviews/device-cookie";
import {
  createDealerReviewSchema,
  moderateDealerReviewSchema,
  type CreateDealerReviewInput,
  type ModerateDealerReviewInput,
} from "@/lib/validations/dealer-review";

function toSafeComment(comment: string | undefined) {
  const trimmed = comment?.trim();
  return trimmed ? trimmed : null;
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

  const dealer = await db.dealerProfile.findUnique({
    where: { id: parsed.data.dealerId },
    select: { id: true, slug: true },
  });
  if (!dealer) return { error: "Dealer not found" };

  try {
    const comment = toSafeComment(parsed.data.comment);

    if (currentUser) {
      const review = await db.dealerReview.upsert({
        where: {
          dealerId_reviewerUserId: {
            dealerId: dealer.id,
            reviewerUserId: currentUser.id,
          },
        },
        update: {
          rating: parsed.data.rating,
          comment,
          reviewerType: "REGISTERED",
          reviewerName: currentUser.name?.trim() || null,
          reviewerDeviceId: null,
          status: "PENDING",
          adminNotes: null,
          moderatedAt: null,
        },
        create: {
          dealerId: dealer.id,
          reviewerUserId: currentUser.id,
          reviewerType: "REGISTERED",
          reviewerName: currentUser.name?.trim() || null,
          rating: parsed.data.rating,
          comment,
        },
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

    const deviceId = await getOrCreateReviewDeviceId();
    const review = await db.dealerReview.upsert({
      where: {
        dealerId_reviewerDeviceId: {
          dealerId: dealer.id,
          reviewerDeviceId: deviceId,
        },
      },
      update: {
        rating: parsed.data.rating,
        reviewerType: "ANONYMOUS",
        reviewerUserId: null,
        reviewerName: null,
        comment: null,
        status: "PENDING",
        adminNotes: null,
        moderatedAt: null,
      },
      create: {
        dealerId: dealer.id,
        reviewerDeviceId: deviceId,
        reviewerType: "ANONYMOUS",
        rating: parsed.data.rating,
      },
    });

    revalidatePath(`/dealers/${dealer.slug}`);
    revalidatePath("/admin/reviews");
    return { data: review };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit dealer review";
    return { error: message };
  }
}

export async function moderateDealerReview(input: ModerateDealerReviewInput) {
  await requireRole("ADMIN");
  const parsed = moderateDealerReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const review = await db.dealerReview.update({
      where: { id: parsed.data.reviewId },
      data: {
        status: parsed.data.status,
        adminNotes: parsed.data.adminNotes?.trim() || null,
        moderatedAt: new Date(),
      },
      include: {
        dealer: { select: { slug: true } },
      },
    });

    revalidatePath(`/dealers/${review.dealer.slug}`);
    revalidatePath("/admin/reviews");
    return { data: review };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to moderate dealer review";
    return { error: message };
  }
}
