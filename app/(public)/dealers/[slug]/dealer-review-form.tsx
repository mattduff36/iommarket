"use client";

import { useState, useTransition } from "react";
import { submitDealerReview } from "@/actions/dealer-reviews";
import { Button } from "@/components/ui/button";

interface Props {
  dealerId: string;
  canComment: boolean;
}

export function DealerReviewForm({ dealerId, canComment }: Props) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await submitDealerReview({
        dealerId,
        rating,
        comment: canComment ? comment : "",
      });

      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Could not submit your review."
        );
        return;
      }

      setSuccess("Review submitted for moderation. It will appear once approved.");
      if (canComment) setComment("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="rating" className="text-sm font-medium text-text-primary">
          Rating
        </label>
        <select
          id="rating"
          value={rating}
          onChange={(event) => setRating(Number(event.target.value))}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-text-primary"
        >
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Average</option>
          <option value={2}>2 - Fair</option>
          <option value={1}>1 - Poor</option>
        </select>
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
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            placeholder="Share your experience with this dealer"
          />
        </div>
      ) : (
        <p className="text-xs text-text-secondary">
          Sign in to add a named written comment. Anonymous reviews can submit a star rating only.
        </p>
      )}

      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-500">{success}</p> : null}

      <Button type="submit" loading={isPending}>
        Submit review
      </Button>
    </form>
  );
}
