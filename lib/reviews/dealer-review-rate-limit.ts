import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import type { RateLimitResult } from "@/lib/rate-limit-result";

export async function dealerReviewRateAllowed(input: {
  action: "submit" | "draft" | "response-submit" | "dispute";
  actor: string;
  target: string;
}): Promise<RateLimitResult> {
  const aggregate = await checkRateLimit(
    makeRateLimitKey("dealer-review-workflow-actor", input.actor),
    { windowMs: 600_000, maxRequests: 24, policy: "dealer-review-actor" },
  );
  if (!aggregate.allowed) return aggregate;

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
    { windowMs: 600_000, maxRequests: limits[input.action], policy: `dealer-review-${input.action}` },
  );
}
