export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  CARD_OVERLAY_CONTROL_CLASS,
  CardOverlayLink,
} from "@/components/ui/card-overlay-link";
import { ReviewActions } from "./review-actions";
import { AdminPager } from "@/components/admin/admin-pager";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";

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

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? "PENDING";
  const page = parseAdminPage(params.page);
  const where = status === "ALL" ? {} : { status: status as "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN" };
  const [reviews, total] = await Promise.all([
    db.dealerReview.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * 25,
      take: 25,
      include: {
        dealer: { select: { id: true, name: true, slug: true } },
        reviewer: { select: { email: true } },
      },
    }),
    db.dealerReview.count({ where }),
  ]);
  const totalPages = adminTotalPages(total, 25);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dealer Reviews</h1>
      <p className="mb-4 text-sm text-text-secondary">
        REJECTED never publishes. HIDDEN withdraws a previously approved review.
      </p>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {["PENDING", "APPROVED", "REJECTED", "HIDDEN", "ALL"].map((value) => (
          <a
            key={value}
            href={`/admin/reviews?status=${value}`}
            className={value === status ? "text-text-primary" : "text-text-secondary"}
          >
            {value}
          </a>
        ))}
      </div>
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className="relative rounded-lg border border-border p-4 bg-surface">
            <CardOverlayLink
              href={`/dealers/${review.dealer.slug}`}
              label={review.dealer.name}
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{review.dealer.name}</p>
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

            <div className={`mt-3 max-w-md ${CARD_OVERLAY_CONTROL_CLASS}`}>
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
      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => `/admin/reviews?status=${status}&page=${nextPage}`}
      />
    </div>
  );
}
