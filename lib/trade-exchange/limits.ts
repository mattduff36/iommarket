import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

export async function tradeRateLimit(scope: string, identifier: string, maxRequests: number, windowMs: number): Promise<string | null> {
  const result = await checkRateLimit(makeRateLimitKey(`trade-${scope}`, identifier), {
    maxRequests,
    windowMs,
    policy: "trade-exchange",
  });
  if (!result.allowed) return "Too many requests. Try again later.";
  return null;
}
