import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  COOKIE_CONSENT_COOKIE_NAME,
  isMarketingAllowed,
  parseCookieConsent,
} from "@/lib/consent/cookie-consent";
import { BROWSER_ADVERTISING_EVENTS } from "@/lib/advertising/outcomes";
import { deliverAdvertisingEvents } from "@/lib/advertising/deliver";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

const eventSchema = z.object({
  eventName: z.enum(BROWSER_ADVERTISING_EVENTS),
  eventId: z.string().regex(/^[A-Za-z0-9:_-]{8,80}$/),
  contentId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  context: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  path: z.string().regex(/^\/[A-Za-z0-9/_-]{0,100}$/).optional(),
}).strict();

export async function POST(request: Request) {
  const limited = await checkRateLimit(makeRateLimitKey("advertising-events", request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"), {
    windowMs: 60_000,
    maxRequests: 30,
    policy: "advertising-events",
  });
  if (!limited.allowed || limited.unavailable) {
    return NextResponse.json({ delivered: false, reason: "rate_limit" });
  }

  let payload: z.infer<typeof eventSchema>;
  try {
    payload = eventSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ delivered: false, reason: "invalid" });
  }

  const consent = parseCookieConsent((await cookies()).get(COOKIE_CONSENT_COOKIE_NAME)?.value);
  if (!isMarketingAllowed(consent)) {
    return NextResponse.json({ delivered: false, reason: "consent" });
  }

  let sourceUrl: string | null = null;
  if (payload.path) {
    try {
      sourceUrl = new URL(payload.path, getCanonicalBaseUrl()).toString();
    } catch {
      sourceUrl = null;
    }
  }

  const result = await deliverAdvertisingEvents(
    [{
      eventName: payload.eventName,
      eventId: payload.eventId,
      contentId: payload.contentId,
      category: payload.category,
      context: payload.context,
    }],
    { sourceUrl },
  );
  return NextResponse.json({ delivered: result.delivered, reason: result.reason });
}
