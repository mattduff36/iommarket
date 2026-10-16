import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { finalizeListingImageUploadIntent } from "@/lib/listings/photo-upload";
import { processListingImageCleanupJobs } from "@/lib/listings/photo-cleanup";
import { publicErrorBody } from "@/lib/forms/public-error";
import { uploadAuthErrorBody } from "@/lib/media/upload-auth-error";
import { captureException } from "@/lib/monitoring";
import { respondToUploadError } from "@/lib/media/upload-error-catalog";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitPublicError } from "@/lib/rate-limit-result";
import {
  ADMIN_OWNED_LISTING_ERROR,
  isAdminSellerBlocked,
} from "@/lib/listings/seller-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const finalizeSchema = z.object({
  uploadIntentId: z.string().min(1),
  publicId: z.string().min(1),
  assetId: z.string().optional(),
  version: z.union([z.string(), z.number()]).optional(),
});

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

async function runCleanupWithoutFailingFinalize(userId: string) {
  try {
    await processListingImageCleanupJobs();
  } catch (cleanupError) {
    await captureException({
      source: "SERVER",
      error: cleanupError,
      action: "processListingImageCleanupJobs",
      route: "/api/listing-images/finalize",
      requestPath: "/api/listing-images/finalize",
      userId,
    });
  }
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
      route: "/api/listing-images/finalize",
      requestPath: "/api/listing-images/finalize",
    }));
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const rateBody = rateLimitPublicError(
    await checkRateLimit(makeRateLimitKey("listing-image-finalize", user.id), {
      windowMs: 60_000,
      maxRequests: 20,
      policy: "listing-image-finalize",
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
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(publicErrorBody({ message: "Invalid upload data", code: "validation" }), { status: 400 });
  }

  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(publicErrorBody({ message: "Invalid upload data", code: "validation" }), { status: 400 });
  }

  try {
    const result = await finalizeListingImageUploadIntent({
      userId: user.id,
      intentId: parsed.data.uploadIntentId,
      publicId: parsed.data.publicId,
      assetId: parsed.data.assetId,
      version: parsed.data.version == null ? undefined : String(parsed.data.version),
    });
    if (result.error || !result.data) {
      await runCleanupWithoutFailingFinalize(user.id);
      const classified = await respondToUploadError(new Error(result.error ?? "Could not verify the uploaded image."), () =>
        captureException({
          source: "SERVER",
          error: new Error(result.error ?? "Could not verify the uploaded image."),
          action: "finalizeListingImageUploadIntent",
          route: "/api/listing-images/finalize",
          requestPath: "/api/listing-images/finalize",
          userId: user.id,
        }),
      );
      return NextResponse.json(classified.body, { status: classified.status });
    }

    const verified = result.data;
    await runCleanupWithoutFailingFinalize(user.id);

    return NextResponse.json(
      {
        data: {
          uploadIntentId: verified.id,
          publicId: verified.publicId,
          assetId: verified.assetId,
          version: verified.version,
          width: verified.width,
          height: verified.height,
          format: verified.format,
          bytes: verified.bytes,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const classified = await respondToUploadError(error, () => captureException({
      source: "SERVER",
      error,
      action: "finalizeListingImageUploadIntent",
      route: "/api/listing-images/finalize",
      requestPath: "/api/listing-images/finalize",
      userId: user.id,
    }));
    return NextResponse.json(classified.body, { status: classified.status });
  }
}
