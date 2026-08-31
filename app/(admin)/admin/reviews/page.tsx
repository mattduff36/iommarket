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
import {
  ResponseRevisionActions,
  ReviewDisputeActions,
} from "./response-dispute-actions";

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
  const [reviews, total, responseRevisions, disputes] = await Promise.all([
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
    db.dealerReviewResponseRevision.findMany({
      where: { status: "PENDING" },
      orderBy: { submittedAt: "asc" },
      take: 50,
      include: {
        response: {
          include: {
            review: {
              include: {
                dealer: { select: { name: true, slug: true } },
              },
            },
          },
        },
      },
    }),
    db.dealerReviewDispute.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: {
        review: {
          include: {
            dealer: { select: { name: true, slug: true } },
          },
        },
      },
    }),
  ]);
  const totalPages = adminTotalPages(total, 25);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dealer Reviews</h1>
      <p className="mb-4 text-sm text-text-secondary">
        Review responses and disputes are private until an administrator makes a
        decision. REJECTED never publishes. HIDDEN withdraws a previously approved
        review and its response from public view.
      </p>
      <section className="mb-8" aria-labelledby="pending-responses-heading">
        <div className="mb-3 flex items-center gap-2">
          <h2
            id="pending-responses-heading"
            className="text-lg font-semibold text-text-primary"
          >
            Pending dealer responses
          </h2>
          <Badge variant={responseRevisions.length > 0 ? "warning" : "neutral"}>
            {responseRevisions.length}
          </Badge>
        </div>
        <div className="space-y-4">
          {responseRevisions.map((revision) => {
            const review = revision.response.review;
            return (
              <article
                key={revision.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {review.dealer.name}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      Review status: {review.status} · Submitted{" "}
                      {revision.submittedAt?.toLocaleDateString("en-GB") ?? "-"}
                    </p>
                  </div>
                  <Badge variant="warning">PENDING RESPONSE</Badge>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                      Customer review
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                      {review.comment}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                      Proposed dealer response
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                      {revision.body}
                    </p>
                  </div>
                </div>
                <div className="mt-3 max-w-3xl">
                  <ResponseRevisionActions
                    revisionId={revision.id}
                    revisionVersion={revision.version}
                    responseVersion={revision.response.version}
                  />
                </div>
              </article>
            );
          })}
          {responseRevisions.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No dealer responses are awaiting moderation.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mb-8" aria-labelledby="open-disputes-heading">
        <div className="mb-3 flex items-center gap-2">
          <h2
            id="open-disputes-heading"
            className="text-lg font-semibold text-text-primary"
          >
            Open review disputes
          </h2>
          <Badge variant={disputes.length > 0 ? "warning" : "neutral"}>
            {disputes.length}
          </Badge>
        </div>
        <div className="space-y-4">
          {disputes.map((dispute) => {
            const evidence =
              dispute.evidenceMetadata &&
              typeof dispute.evidenceMetadata === "object" &&
              !Array.isArray(dispute.evidenceMetadata) &&
              "notes" in dispute.evidenceMetadata &&
              typeof dispute.evidenceMetadata.notes === "string"
                ? dispute.evidenceMetadata.notes
                : null;
            return (
              <article
                key={dispute.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {dispute.review.dealer.name}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      Review status: {dispute.review.status} · Reason:{" "}
                      {dispute.reasonCode}
                    </p>
                  </div>
                  <Badge variant="warning">OPEN DISPUTE</Badge>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">
                  {dispute.body}
                </p>
                {evidence ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-text-tertiary">
                    Evidence notes: {evidence}
                  </p>
                ) : null}
                <div className="mt-3 max-w-3xl">
                  <ReviewDisputeActions
                    disputeId={dispute.id}
                    version={dispute.version}
                  />
                </div>
              </article>
            );
          })}
          {disputes.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No dealer review disputes are open.
            </p>
          ) : null}
        </div>
      </section>

      <h2 className="mb-3 text-lg font-semibold text-text-primary">
        Customer review moderation
      </h2>
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
                currentVersion={review.moderationVersion}
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
