import { readUploadJson } from "@/lib/media/upload-request";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { acceptedAuthHttpStatus, requireAcceptedAuth } from "@/lib/policy/gate";
import { issueListingImageUploadIntent } from "@/lib/listings/photo-upload";
import { captureException } from "@/lib/monitoring";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
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
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let user;
  try {
    user = await requireAcceptedAuth();
  } catch (error) {
    return NextResponse.json(
      { error: "Not authorized" },
      { status: acceptedAuthHttpStatus(error) },
    );
  }

  const rateDenial = toRateLimitDenial(
    await checkRateLimit(makeRateLimitKey("listing-image-intent", user.id), {
      windowMs: 60_000,
      maxRequests: 20,
      policy: "listing-image-intent",
    }),
    "Too many upload attempts. Try again shortly.",
  );
  if (rateDenial) {
    return NextResponse.json(
      { error: rateDenial.message },
      { status: rateDenial.status, headers: { "Retry-After": String(rateDenial.retryAfterSeconds) } },
    );
  }
  if (isAdminSellerBlocked(user.role)) {
    return NextResponse.json({ error: ADMIN_OWNED_LISTING_ERROR }, { status: 403 });
  }

  let body: unknown;
  try { body = await readUploadJson(request, true); }
  catch { return NextResponse.json({ error: "Invalid upload metadata." }, { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload metadata." }, { status: 400 });
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
