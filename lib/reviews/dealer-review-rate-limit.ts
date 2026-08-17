import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

export function dealerReviewRateAllowed(input: {
  action: "submit" | "draft" | "response-submit" | "dispute";
  actor: string;
  target: string;
}) {
  const aggregate = checkRateLimit(
    makeRateLimitKey("dealer-review-workflow-actor", input.actor),
    { windowMs: 600_000, maxRequests: 24 },
  );
  if (!aggregate.allowed) return false;

  const limits = {
    submit: 6,
    draft: 12,
    "response-submit": 6,
    dispute: 4,
  } as const;
  return checkRateLimit(
    makeRateLimitKey(
      `dealer-review-${input.action}`,
      `${input.actor}:${input.target}`,
    ),
    { windowMs: 600_000, maxRequests: limits[input.action] },
  ).allowed;
}
