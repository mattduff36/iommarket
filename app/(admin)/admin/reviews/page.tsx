export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Dealer Reviews" };

const STATUS_VARIANT: Record<
  string,
  "neutral" | "warning" | "success" | "error" | "info" | "premium"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
  HIDDEN: "neutral",
};

function stars(rating: number) {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

export default async function AdminReviewsPage() {
  const reviews = await db.dealerReview.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      dealer: { select: { id: true, name: true, slug: true } },
      reviewer: { select: { email: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dealer Reviews</h1>
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className="rounded-lg border border-border p-4 bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/dealers/${review.dealer.slug}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {review.dealer.name}
                </Link>
                <p className="text-xs text-text-secondary mt-1">
                  {review.reviewerType === "REGISTERED"
                    ? `Registered user${review.reviewer?.email ? ` (${review.reviewer.email})` : ""}`
                    : "Anonymous reviewer"}{" "}
                  · {review.createdAt.toLocaleDateString("en-GB")}
                </p>
                <p className="text-sm text-premium-gold-500 mt-2" aria-label={`${review.rating} stars`}>
                  {stars(review.rating)}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[review.status] ?? "neutral"}>
                {review.status}
              </Badge>
            </div>

            {review.comment ? (
              <p className="mt-3 text-sm text-text-secondary whitespace-pre-wrap">
                {review.comment}
              </p>
            ) : (
              <p className="mt-3 text-sm text-text-tertiary italic">No written comment</p>
            )}

            <div className="mt-3 max-w-md">
              <ReviewActions
                reviewId={review.id}
                currentStatus={review.status}
                currentAdminNotes={review.adminNotes}
              />
            </div>
          </div>
        ))}

        {reviews.length === 0 ? (
          <p className="text-sm text-text-secondary">No dealer reviews submitted yet.</p>
        ) : null}
      </div>
    </div>
  );
}
