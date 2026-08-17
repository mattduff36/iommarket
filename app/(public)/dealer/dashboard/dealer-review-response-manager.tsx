"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  openDealerReviewDispute,
  saveDealerReviewResponseDraft,
  submitDealerReviewResponse,
} from "@/actions/dealer-reviews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ManagedDealerReview } from "@/lib/reviews/dealer-review-client";

type ModerationReason = "POLICY" | "ABUSE" | "SPAM" | "OFF_TOPIC" | "OTHER";

function resultError(error: unknown) {
  if (typeof error === "string") return error;
  return "The request could not be saved. Refresh and try again.";
}

function stars(rating: number) {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

function ReviewManagementItem({ review }: { review: ManagedDealerReview }) {
  const router = useRouter();
  const [revision, setRevision] = useState(review.activeRevision);
  const [body, setBody] = useState(
    review.activeRevision?.body ??
      (review.lastDecision?.status === "REJECTED"
        ? review.lastDecision.body
        : review.approvedResponse?.body) ??
      "",
  );
  const [disputeReason, setDisputeReason] =
    useState<ModerationReason>("POLICY");
  const [disputeBody, setDisputeBody] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const responseIsPending = revision?.status === "PENDING";
  const disputeIsOpen = review.latestDispute?.status === "OPEN";

  function saveDraft() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveDealerReviewResponseDraft({
        reviewId: review.id,
        revisionId: revision?.id,
        expectedVersion: revision?.version,
        body,
      });
      if (result.error) {
        setError(resultError(result.error));
        return;
      }
      if ("data" in result && result.data) {
        setRevision({
          id: result.data.id,
          body: result.data.body,
          status: result.data.status as "DRAFT" | "PENDING",
          version: result.data.version,
        });
        setBody(result.data.body);
        setMessage(
          "conflict" in result && result.conflict
            ? "Another save completed first. The latest draft has been loaded."
            : "Draft saved.",
        );
      }
    });
  }

  function submitResponse() {
    if (!revision || revision.status !== "DRAFT") {
      setError("Save a draft before submitting it for moderation.");
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await submitDealerReviewResponse({
        reviewId: review.id,
        revisionId: revision.id,
        expectedVersion: revision.version,
      });
      if (result.error) {
        setError(resultError(result.error));
        return;
      }
      if (result.data) {
        setRevision({
          id: result.data.id,
          body: result.data.body,
          status: "PENDING",
          version: result.data.version,
        });
        setMessage(
          review.approvedResponse
            ? "Update submitted. Your current approved response remains public while this is reviewed."
            : "Response submitted for moderation.",
        );
        router.refresh();
      }
    });
  }

  function openDispute() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await openDealerReviewDispute({
        reviewId: review.id,
        reasonCode: disputeReason,
        body: disputeBody,
        evidenceNotes: evidenceNotes || undefined,
      });
      if (result.error) {
        setError(resultError(result.error));
        return;
      }
      setDisputeBody("");
      setEvidenceNotes("");
      setMessage("Dispute opened for administrator review.");
      router.refresh();
    });
  }

  return (
    <article className="rounded-lg border border-border bg-canvas/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            className="text-sm text-premium-gold-500"
            aria-label={`${review.rating} stars`}
          >
            {stars(review.rating)}
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            Approved {new Date(review.createdAt).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {revision ? (
            <Badge variant={revision.status === "PENDING" ? "warning" : "neutral"}>
              RESPONSE {revision.status}
            </Badge>
          ) : review.lastDecision?.status === "REJECTED" ? (
            <Badge variant="error">RESPONSE REJECTED</Badge>
          ) : review.approvedResponse ? (
            <Badge variant="success">RESPONSE LIVE</Badge>
          ) : (
            <Badge variant="neutral">NO RESPONSE</Badge>
          )}
          {review.latestDispute ? (
            <Badge
              variant={
                review.latestDispute.status === "OPEN"
                  ? "warning"
                  : review.latestDispute.status === "RESOLVED"
                    ? "success"
                    : "error"
              }
            >
              DISPUTE {review.latestDispute.status}
            </Badge>
          ) : null}
        </div>
      </div>

      <blockquote className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">
        {review.comment ? `“${review.comment}”` : "Star rating only — no written comment"}
      </blockquote>

      {review.canRespond && review.approvedResponse ? (
        <div className="mt-4 rounded-md bg-surface p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Current public response
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
            {review.approvedResponse.body}
          </p>
        </div>
      ) : null}

      {review.canRespond ? (
        <div className="mt-4">
          <label
            htmlFor={`dealer-response-${review.id}`}
            className="text-sm font-medium text-text-primary"
          >
            {review.approvedResponse ? "Proposed response update" : "Dealer response"}
          </label>
          <textarea
            id={`dealer-response-${review.id}`}
            rows={4}
            maxLength={2000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={isPending || responseIsPending}
            className="mt-2 w-full rounded-md border border-border bg-surface p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none focus:shadow-outline disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Write a factual, professional response. Do not include personal contact details."
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={saveDraft}
              disabled={isPending || responseIsPending || !body.trim()}
            >
              Save draft
            </Button>
            <Button
              type="button"
              onClick={submitResponse}
              disabled={
                isPending ||
                responseIsPending ||
                revision?.status !== "DRAFT"
              }
            >
              Submit for review
            </Button>
          </div>
          {responseIsPending ? (
            <p className="mt-2 text-xs text-text-secondary">
              This response is awaiting moderation and cannot be edited.
              {review.approvedResponse
                ? " The approved response above remains public."
                : ""}
            </p>
          ) : null}
          {review.lastDecision?.status === "REJECTED" && !revision ? (
            <p className="mt-2 text-xs text-text-error">
              The previous response was rejected
              {review.lastDecision.reason
                ? ` (${review.lastDecision.reason})`
                : ""}
              . You can revise the text and save a new draft.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-secondary">
          Responses are available only for reviews with a written comment. You can
          still dispute this approved rating below.
        </p>
      )}

      <details className="mt-4 border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium text-text-trust">
          {disputeIsOpen ? "Dispute awaiting a decision" : "Dispute this review"}
        </summary>
        {disputeIsOpen ? (
          <p className="mt-2 text-sm text-text-secondary">
            An administrator is reviewing your dispute. The review remains public
            unless its moderation status changes.
          </p>
        ) : (
          <div className="mt-3 grid gap-3">
            <label className="text-sm text-text-secondary">
              Reason
              <select
                value={disputeReason}
                onChange={(event) =>
                  setDisputeReason(event.target.value as ModerationReason)
                }
                disabled={isPending}
                className="mt-1 block h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:shadow-outline"
              >
                <option value="POLICY">Policy concern</option>
                <option value="ABUSE">Abusive content</option>
                <option value="SPAM">Spam or manipulation</option>
                <option value="OFF_TOPIC">Not about this dealership</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="text-sm text-text-secondary">
              Dispute details
              <textarea
                rows={3}
                maxLength={3000}
                value={disputeBody}
                onChange={(event) => setDisputeBody(event.target.value)}
                disabled={isPending}
                className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:shadow-outline"
              />
            </label>
            <label className="text-sm text-text-secondary">
              Evidence notes (optional)
              <textarea
                rows={2}
                maxLength={2000}
                value={evidenceNotes}
                onChange={(event) => setEvidenceNotes(event.target.value)}
                disabled={isPending}
                className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:shadow-outline"
              />
            </label>
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={openDispute}
                disabled={isPending || disputeBody.trim().length < 10}
              >
                Open dispute
              </Button>
            </div>
          </div>
        )}
      </details>

      {message ? (
        <p className="mt-3 text-sm text-text-trust" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function DealerReviewResponseManager({
  reviews,
}: {
  reviews: ManagedDealerReview[];
}) {
  return (
    <section
      id="review-management"
      className="mb-8 rounded-lg border border-border bg-surface p-5"
      aria-labelledby="review-management-heading"
    >
      <div className="max-w-2xl">
        <h2
          id="review-management-heading"
          className="text-lg font-semibold text-text-primary"
        >
          Review responses and disputes
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Respond to approved written reviews or ask an administrator to assess a
          review. Responses are moderated before publication and never change the
          rating.
        </p>
      </div>
      <div className="mt-4 space-y-4">
        {reviews.map((review) => (
          <ReviewManagementItem key={review.id} review={review} />
        ))}
        {reviews.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Approved written reviews will appear here when they are available to
            respond to.
          </p>
        ) : null}
      </div>
    </section>
  );
}
