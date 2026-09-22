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
  return toRateLimitDenial(result, limitedMessage)?.message ?? null;
}
