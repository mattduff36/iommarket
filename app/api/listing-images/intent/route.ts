import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { issueListingImageUploadIntent } from "@/lib/listings/photo-upload";
import { captureException } from "@/lib/monitoring";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const rate = checkRateLimit(makeRateLimitKey("listing-image-intent", user.id), {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many upload attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const issued = await issueListingImageUploadIntent(user.id);
    return NextResponse.json(
      {
        data: {
          uploadIntentId: issued.intent.id,
          publicId: issued.intent.publicId,
          expiresAt: issued.intent.expiresAt.toISOString(),
          upload: issued.upload,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "issueListingImageUploadIntent",
      route: "/api/listing-images/intent",
      requestPath: "/api/listing-images/intent",
      userId: user.id,
    });
    return NextResponse.json({ error: "Could not start the image upload." }, { status: 500 });
  }
}
