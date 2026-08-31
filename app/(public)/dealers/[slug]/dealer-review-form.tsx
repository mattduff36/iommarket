"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitDealerReview } from "@/actions/dealer-reviews";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";

interface Props {
  dealerId: string;
  canComment: boolean;
}

export function DealerReviewForm({ dealerId, canComment }: Props) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSuccess(null);

    startTransition(async () => {
      const result = await submitDealerReview({
        dealerId,
        rating,
        comment: canComment ? comment : "",
      });

      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(split.formError);
        return;
      }

      setSuccess("Review submitted for moderation. It will appear once approved.");
      if (canComment) setComment("");
    });
  }

  const commentError = firstFieldError(fieldErrors, "comment");
  const ratingError = firstFieldError(fieldErrors, "rating");

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <div className="flex flex-col gap-1">
        <label htmlFor="rating" className="text-sm font-medium text-text-primary">
          Rating
        </label>
        <select
          id="rating"
          value={rating}
          onChange={(event) => setRating(Number(event.target.value))}
          aria-invalid={ratingError ? true : undefined}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
        >
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Average</option>
          <option value={2}>2 - Fair</option>
          <option value={1}>1 - Poor</option>
        </select>
        {ratingError ? <p className="text-xs text-text-error">{ratingError}</p> : null}
      </div>

      {canComment ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="comment" className="text-sm font-medium text-text-primary">
            Comment (optional)
          </label>
          <textarea
            id="comment"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            aria-invalid={commentError ? true : undefined}
            className={[
              "w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary",
              commentError ? "border-neon-red-500" : "border-border",
            ].join(" ")}
            placeholder="Share your experience with this dealer"
          />
          {commentError ? <p className="text-xs text-text-error">{commentError}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-text-secondary">
          Sign in to add a named written comment. Anonymous reviews can submit a star rating only.
        </p>
      )}

      <p className="text-xs text-text-secondary">
        Reviews are moderated and may be removed if they breach our{" "}
        <Link href="/acceptable-use" className="text-text-trust hover:underline">
          Acceptable Use Policy
        </Link>
        . Do not include personal data you do not want published. See our{" "}
        <Link href="/privacy" className="text-text-trust hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      {success ? <p className="text-sm text-emerald-500">{success}</p> : null}

      <Button type="submit" loading={isPending}>
        Submit review
      </Button>
    </form>
  );
}
