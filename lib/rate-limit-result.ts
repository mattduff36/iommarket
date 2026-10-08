import { publicErrorBody, type PublicErrorBody } from "@/lib/forms/public-error";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  unavailable: boolean;
}

export interface RateLimitDenial {
  status: 429 | 503;
  message: string;
  retryAfterSeconds: number;
}

export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again shortly.";

export function toRateLimitDenial(
  result: RateLimitResult,
  limitedMessage: string,
  now = Date.now(),
): RateLimitDenial | null {
  if (result.unavailable) {
    return {
      status: 503,
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
      retryAfterSeconds: 30,
    };
  }
  if (!result.allowed) {
    return {
      status: 429,
      message: limitedMessage,
      retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
    };
  }
  return null;
}

export function rateLimitActionError(
  result: RateLimitResult,
  limitedMessage: string,
): string | null {
  return rateLimitRecoveryMessage(result, limitedMessage);
}

function reliableRetrySeconds(resetAt: number, now: number): number | null {
  if (!Number.isFinite(resetAt)) return null;
  const seconds = Math.ceil((resetAt - now) / 1000);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return null;
  return seconds;
}

/**
 * A real 429 with a finite reset includes the wait. A missing reset keeps the
 * caller's sentence. Limiter outage stays the unavailable sentence and does
 * not claim the person is throttled.
 */
export function rateLimitRecoveryMessage(
  result: RateLimitResult,
  limitedMessage: string,
  now = Date.now(),
): string | null {
  if (result.unavailable) return RATE_LIMIT_UNAVAILABLE_MESSAGE;
  if (result.allowed) return null;
  const seconds = reliableRetrySeconds(result.resetAt, now);
  if (seconds === null) return limitedMessage;
  const base = limitedMessage.trim().split(/Please wait|Wait |Try again/i)[0].trim().replace(/\.$/, "");
  return `${base}. Wait ${seconds} ${seconds === 1 ? "second" : "seconds"}, then try again.`;
}

/** Additive wait-time payload. Existing string callers keep rateLimitActionError. */
export function rateLimitPublicError(
  result: RateLimitResult,
  limitedMessage: string,
  now = Date.now(),
): PublicErrorBody | null {
  const denial = toRateLimitDenial(result, limitedMessage, now);
  if (!denial) return null;
  return publicErrorBody({
    message: rateLimitRecoveryMessage(result, limitedMessage, now) ?? denial.message,
    code: denial.status === 429 ? "rate_limited" : "unavailable",
    retryAfterSeconds: denial.retryAfterSeconds,
  });
}
