import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { imageKitDevUploadsEnabled } from "@/lib/media/config";
import { uploadDisposableImage, deleteDisposableImageKitFile } from "@/lib/media/disposable-media";
import { listingUploadFormat, stripListingImageMetadata } from "@/lib/media/strip-metadata";
import { verifyImageKitListingUpload } from "@/lib/listings/photo-upload";
import { db } from "@/lib/db";
import { publicErrorBody } from "@/lib/forms/public-error";
import { uploadAuthErrorBody } from "@/lib/media/upload-auth-error";
import { captureException } from "@/lib/monitoring";
import { respondToUploadError } from "@/lib/media/upload-error-catalog";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitPublicError } from "@/lib/rate-limit-result";
import { ADMIN_OWNED_LISTING_ERROR, isAdminSellerBlocked } from "@/lib/listings/seller-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const intentSchema = z.string().min(1).max(80);

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!imageKitDevUploadsEnabled()) {
    return NextResponse.json(publicErrorBody({ message: "ImageKit development uploads are disabled.", code: "unavailable" }), { status: 404 });
  }
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
      route: "/api/listing-images/imagekit-upload",
      requestPath: "/api/listing-images/imagekit-upload",
    }));
    return NextResponse.json(auth.body, { status: auth.status });
  }
  const rateBody = rateLimitPublicError(
    await checkRateLimit(makeRateLimitKey("listing-image-imagekit", user.id), {
      windowMs: 60_000,
      maxRequests: 10,
      policy: "listing-image-imagekit",
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

  const form = await request.formData();
  const intentId = intentSchema.safeParse(form.get("uploadIntentId"));
  const file = form.get("file");
  if (!intentId.success || !(file instanceof File)) {
    return NextResponse.json(publicErrorBody({ message: "Upload request is invalid.", code: "validation" }), { status: 400 });
  }
  if (file.size <= 0 || file.size > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return NextResponse.json(publicErrorBody({ message: "Images must be 10MB or smaller.", code: "validation" }), { status: 400 });
  }

  const intent = await db.listingImageUploadIntent.findUnique({ where: { id: intentId.data } });
  if (!intent || intent.userId !== user.id || intent.deliveryType !== "imagekit" || intent.status !== "ISSUED") {
    return NextResponse.json(publicErrorBody({ message: "Upload not found.", code: "not_found" }), { status: 404 });
  }

  let uploaded: { fileId: string; filePath: string } | null = null;
  try {
    const format = listingUploadFormat(file.name, file.type);
    const stripped = await stripListingImageMetadata({
      bytes: Buffer.from(await file.arrayBuffer()),
      format,
    });
    const safeName = `listing.${stripped.format === "jpg" ? "jpg" : stripped.format}`;
    uploaded = await uploadDisposableImage({
      bytes: stripped.bytes,
      fileName: safeName,
      folder: intent.folder,
      purpose: "dev-upload",
    });
    const verified = await verifyImageKitListingUpload({
      userId: user.id,
      intentId: intent.id,
      fileId: uploaded.fileId,
      filePath: uploaded.filePath,
      width: stripped.width,
      height: stripped.height,
      format: stripped.format,
      bytes: stripped.bytesLength,
    });
    if ("error" in verified && verified.error) {
      const reason = verified.error;
      await deleteDisposableImageKitFile({
        fileId: uploaded.fileId,
        filePath: uploaded.filePath,
        allowlist: [uploaded],
      });
      const classified = await respondToUploadError(new Error(reason), () => captureException({
        source: "SERVER",
        error: new Error(reason),
        action: "verifyImageKitListingUpload",
        route: "/api/listing-images/imagekit-upload",
        requestPath: "/api/listing-images/imagekit-upload",
        userId: user.id,
      }));
      return NextResponse.json(classified.body, { status: classified.status });
    }
    return NextResponse.json({
      data: {
        uploadIntentId: intent.id,
        publicId: `imagekit-dev/${uploaded.fileId}`,
        assetId: uploaded.fileId,
        version: "1",
        width: stripped.width,
        height: stripped.height,
        format: stripped.format,
        bytes: stripped.bytesLength,
        provider: "EXTERNAL",
        url: `imagekit-private:${uploaded.filePath}`,
      },
    });
  } catch (error) {
    if (uploaded) {
      await deleteDisposableImageKitFile({
        fileId: uploaded.fileId,
        filePath: uploaded.filePath,
        allowlist: [uploaded],
      }).catch(() => undefined);
    }
    const classified = await respondToUploadError(error, () => captureException({
      source: "SERVER",
      error,
      action: "imagekitDevListingUpload",
      route: "/api/listing-images/imagekit-upload",
      requestPath: "/api/listing-images/imagekit-upload",
      userId: user.id,
    }));
    return NextResponse.json(classified.body, { status: classified.status });
  }
}
