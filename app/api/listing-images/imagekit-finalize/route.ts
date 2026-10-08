import { readUploadJson } from "@/lib/media/upload-request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { finalizeManagedImageKitUpload } from "@/lib/media/managed-upload";
import { respondToUploadError } from "@/lib/media/upload-error-catalog";
import { imageRecordFromIntent } from "@/lib/media/stored-image";
import { captureException } from "@/lib/monitoring";
import { publicErrorBody } from "@/lib/forms/public-error";
import { uploadAuthErrorBody } from "@/lib/media/upload-auth-error";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitPublicError } from "@/lib/rate-limit-result";
import { ADMIN_OWNED_LISTING_ERROR, isAdminSellerBlocked } from "@/lib/listings/seller-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const requestSchema = z.object({
  uploadIntentId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  fileId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return reply(publicErrorBody({ message: "Invalid request origin.", code: "forbidden" }), 403);
  }
  if (process.env.IMAGEKIT_UPLOADS_ENABLED !== "1") {
    return reply(publicErrorBody({ message: "Managed ImageKit uploads are disabled.", code: "unavailable" }), 404);
  }
  let user;
  try { user = await requireAcceptedAuth(); }
  catch (error) {
    const auth = await uploadAuthErrorBody(error, () => captureException({
      source: "SERVER",
      error,
      action: "requireAcceptedAuth",
      route: "/api/listing-images/imagekit-finalize",
      requestPath: "/api/listing-images/imagekit-finalize",
    }));
    return reply(auth.body, auth.status);
  }
  if (isAdminSellerBlocked(user.role)) {
    return reply(publicErrorBody({ message: ADMIN_OWNED_LISTING_ERROR, code: "forbidden" }), 403);
  }
  const rateBody = rateLimitPublicError(await checkRateLimit(makeRateLimitKey("imagekit-finalize", user.id), {
    windowMs: 60_000, maxRequests: 10, policy: "listing-image-imagekit",
  }), "Too many upload verification attempts.");
  if (rateBody) return NextResponse.json(rateBody, { status: rateBody.code === "unavailable" ? 503 : 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(rateBody.retryAfterSeconds) } });
  const parsed = requestSchema.safeParse(await readUploadJson(request).catch(() => null));
  if (!parsed.success) return reply(publicErrorBody({ message: "Invalid upload request.", code: "validation" }), 400);
  try {
    const intent = await finalizeManagedImageKitUpload({ userId: user.id, intentId: parsed.data.uploadIntentId, fileId: parsed.data.fileId });
    const stored = imageRecordFromIntent(intent);
    return reply({ data: {
      ...stored, uploadIntentId: intent.id, version: intent.version,
      width: intent.width, height: intent.height, format: intent.format, bytes: intent.bytes,
    } });
  } catch (error) {
    const classified = await respondToUploadError(error, () => captureException({
      source: "SERVER",
      error,
      action: "finalizeManagedImageKitUpload",
      route: "/api/listing-images/imagekit-finalize",
      requestPath: "/api/listing-images/imagekit-finalize",
      userId: user.id,
    }));
    return reply(classified.body, classified.status);
  }
}
