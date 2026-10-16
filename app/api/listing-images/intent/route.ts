import { readUploadJson } from "@/lib/media/upload-request";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { uploadAuthErrorBody } from "@/lib/media/upload-auth-error";
import { issueListingImageUploadIntent } from "@/lib/listings/photo-upload";
import { publicErrorBody } from "@/lib/forms/public-error";
import { captureException } from "@/lib/monitoring";
import { PHOTO_START_MESSAGE, PHOTO_UNKNOWN_MESSAGE, classifyUploadError, respondToUploadError } from "@/lib/media/upload-error-catalog";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitPublicError } from "@/lib/rate-limit-result";
import {
  ADMIN_OWNED_LISTING_ERROR,
  isAdminSellerBlocked,
} from "@/lib/listings/seller-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.union([
  z.object({ fileName: z.string().min(1).max(255), fileSize: z.number().int().positive().max(10 * 1024 * 1024), fileType: z.string().max(100) }).strict(),
  z.object({}).strict(),
]);

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(publicErrorBody({ message: "Invalid request origin", code: "forbidden" }), { status: 403 });
  }

  let user;
  try {
    user = await requireAcceptedAuth();
  } catch (error) {
    const auth = await uploadAuthErrorBody(error, () => captureException({
      source: "SERVER",
      error,
      action: "requireAcceptedAuth",
      route: "/api/listing-images/intent",
      requestPath: "/api/listing-images/intent",
    }));
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const rateBody = rateLimitPublicError(
    await checkRateLimit(makeRateLimitKey("listing-image-intent", user.id), {
      windowMs: 60_000,
      maxRequests: 20,
      policy: "listing-image-intent",
    }),
    "Too many upload attempts. Try again shortly.",
  );
  if (rateBody) {
    return NextResponse.json(rateBody, {
      status: rateBody.code === "unavailable" ? 503 : 429,
      headers: { "Retry-After": String(rateBody.retryAfterSeconds) },
    });
  }
  if (isAdminSellerBlocked(user.role)) {
    return NextResponse.json(publicErrorBody({ message: ADMIN_OWNED_LISTING_ERROR, code: "forbidden" }), { status: 403 });
  }

  let body: unknown;
  try { body = await readUploadJson(request, true); }
  catch { return NextResponse.json(publicErrorBody({ message: "Invalid upload metadata.", code: "validation" }), { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(publicErrorBody({ message: "Invalid upload metadata.", code: "validation" }), { status: 400 });
  try {
    const issued = await issueListingImageUploadIntent(user.id, "fileName" in parsed.data ? { fileName: String(parsed.data.fileName), fileSize: Number(parsed.data.fileSize), fileType: String(parsed.data.fileType) } : undefined);
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
    const surfaced = classifyUploadError(error).body.error === PHOTO_UNKNOWN_MESSAGE
      ? new Error(PHOTO_START_MESSAGE)
      : error;
    const classified = await respondToUploadError(surfaced, () => captureException({
      source: "SERVER",
      error,
      action: "issueListingImageUploadIntent",
      route: "/api/listing-images/intent",
      requestPath: "/api/listing-images/intent",
      userId: user.id,
    }));
    return NextResponse.json(classified.body, { status: classified.status });
  }
}
