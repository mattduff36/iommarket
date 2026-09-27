export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { MessageSquare, ShieldCheck, Star } from "lucide-react";
import { db } from "@/lib/db";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import {
  AdminFilterBar,
  AdminFilterChip,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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

const REVIEW_FILTERS = ["PENDING", "APPROVED", "REJECTED", "HIDDEN", "ALL"] as const;

const STATUS_VARIANT: Record<
  string,
  "neutral" | "warning" | "success" | "error" | "info" | "premium"
> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
  HIDDEN: "neutral",
};

function RatingStars({ rating }: { rating: number }) {
  return (
    <span
      className="mt-2 flex items-center gap-0.5 text-premium-gold-500"
      aria-label={`${rating} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill={index < rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
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
    <>
      <AdminPageHeader
        title="Dealer reviews"
        description="Moderate customer reviews, dealer responses, and disputes. Rejected content stays private; hidden content is withdrawn from public view."
      />
      <section className="mb-8" aria-labelledby="pending-responses-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="pending-responses-heading"
            className="text-sm font-semibold text-text-primary"
          >
            Pending dealer responses
          </h2>
          <Badge variant={responseRevisions.length > 0 ? "warning" : "neutral"}>
            {responseRevisions.length}
          </Badge>
        </div>
        <div className="space-y-3">
          {responseRevisions.map((revision) => {
            const review = revision.response.review;
            return (
              <article
                key={revision.id}
                className="rounded-lg border border-border bg-surface p-4 shadow-low"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {review.dealer.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-tertiary">
                      Review status: {review.status} · Submitted{" "}
                      {revision.submittedAt?.toLocaleDateString("en-GB") ?? "-"}
                    </p>
                  </div>
                  <Badge variant="warning">PENDING RESPONSE</Badge>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-border/70 bg-canvas/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                      Customer review
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                      {review.comment}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-canvas/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                      Proposed dealer response
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                      {revision.body}
                    </p>
                  </div>
                </div>
                <div className="mt-4 max-w-3xl">
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
            <AdminEmptyState
              compact
              icon={MessageSquare}
              title="No dealer responses are awaiting moderation"
              description="New or edited responses will appear here for review."
            />
          ) : null}
        </div>
      </section>

      <section className="mb-8" aria-labelledby="open-disputes-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="open-disputes-heading"
            className="text-sm font-semibold text-text-primary"
          >
            Open review disputes
          </h2>
          <Badge variant={disputes.length > 0 ? "warning" : "neutral"}>
            {disputes.length}
          </Badge>
        </div>
        <div className="space-y-3">
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
                className="rounded-lg border border-border bg-surface p-4 shadow-low"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {dispute.review.dealer.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-tertiary">
                      Review status: {dispute.review.status} · Reason:{" "}
                      {dispute.reasonCode}
                    </p>
                  </div>
                  <Badge variant="warning">OPEN DISPUTE</Badge>
                </div>
                <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                  {dispute.body}
                </p>
                {evidence ? (
                  <p className="mt-2 max-w-3xl whitespace-pre-wrap text-xs leading-5 text-text-tertiary">
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
            <AdminEmptyState
              compact
              icon={ShieldCheck}
              title="No dealer review disputes are open"
              description="The dispute queue is clear."
              className="border-emerald-500/25"
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="customer-review-moderation-heading">
        <h2
          id="customer-review-moderation-heading"
          className="mb-3 text-sm font-semibold text-text-primary"
        >
          Customer review moderation
        </h2>
        <AdminFilterBar
          label="Customer review status"
          count={`${total} ${total === 1 ? "review" : "reviews"}`}
        >
          {REVIEW_FILTERS.map((value) => (
            <AdminFilterChip
              key={value}
              href={`/admin/reviews?status=${value}`}
              active={value === status}
              activeTone={
                value === "PENDING"
                  ? "warning"
                  : value === "APPROVED"
                    ? "success"
                    : "neutral"
              }
            >
              {value}
            </AdminFilterChip>
          ))}
        </AdminFilterBar>
        <div className="space-y-3">
          {reviews.map((review) => (
            <article
              key={review.id}
              className="relative rounded-lg border border-border bg-surface p-4 shadow-low"
            >
              <CardOverlayLink
                href={`/dealers/${review.dealer.slug}`}
                label={review.dealer.name}
              />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text-primary">{review.dealer.name}</p>
                  <p className="mt-1 text-xs leading-5 text-text-tertiary">
                    {review.reviewerType === "REGISTERED"
                      ? `Registered user${review.reviewer?.email ? ` (${review.reviewer.email})` : ""}`
                      : "Anonymous reviewer"}{" "}
                    · {review.createdAt.toLocaleDateString("en-GB")}
                  </p>
                  <RatingStars rating={review.rating} />
                </div>
                <Badge variant={STATUS_VARIANT[review.status] ?? "neutral"}>
                  {review.status}
                </Badge>
              </div>

              {review.comment ? (
                <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                  {review.comment}
                </p>
              ) : (
                <p className="mt-3 text-sm text-text-tertiary italic">No written comment</p>
              )}

              <div className={`mt-4 max-w-xl ${CARD_OVERLAY_CONTROL_CLASS}`}>
                <ReviewActions
                  reviewId={review.id}
                  currentVersion={review.moderationVersion}
                  currentStatus={review.status}
                  currentAdminNotes={review.adminNotes}
                />
              </div>
            </article>
          ))}

          {reviews.length === 0 ? (
            <AdminEmptyState
              title="No reviews match this status"
              description="Choose another status to review a different part of the moderation queue."
            />
          ) : null}
        </div>
        <AdminPager
          page={page}
          totalPages={totalPages}
          hrefForPage={(nextPage) => `/admin/reviews?status=${status}&page=${nextPage}`}
        />
      </section>
    </>
  );
}
