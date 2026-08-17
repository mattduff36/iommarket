import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { getActiveModelsByMake } from "@/lib/vehicle-catalogue/queries";

const querySchema = z.object({
  make: z.string().trim().min(1).max(80),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    make: request.nextUrl.searchParams.get("make"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid make is required." }, { status: 400 });
  }

  const requester =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rate = checkRateLimit(makeRateLimitKey("vehicle-models", requester), {
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const models = await getActiveModelsByMake(parsed.data.make);
  return NextResponse.json(
    { models },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
