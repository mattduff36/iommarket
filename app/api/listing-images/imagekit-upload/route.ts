import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { acceptedAuthHttpStatus, requireAcceptedAuth } from "@/lib/policy/gate";
import { imageKitDevUploadsEnabled } from "@/lib/media/config";
import { uploadDisposableImage, deleteDisposableImageKitFile } from "@/lib/media/disposable-media";
import { listingUploadFormat, stripListingImageMetadata } from "@/lib/media/strip-metadata";
import { verifyImageKitListingUpload } from "@/lib/listings/photo-upload";
import { db } from "@/lib/db";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
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
    return NextResponse.json({ error: "ImageKit development uploads are disabled." }, { status: 404 });
  }
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  let user;
  try {
    user = await requireAcceptedAuth();
  } catch (error) {
    return NextResponse.json({ error: "Not authorized" }, { status: acceptedAuthHttpStatus(error) });
  }
  const rateDenial = toRateLimitDenial(
    await checkRateLimit(makeRateLimitKey("listing-image-imagekit", user.id), {
      windowMs: 60_000,
      maxRequests: 10,
      policy: "listing-image-imagekit",
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

  const form = await request.formData();
  const intentId = intentSchema.safeParse(form.get("uploadIntentId"));
  const file = form.get("file");
  if (!intentId.success || !(file instanceof File)) {
    return NextResponse.json({ error: "Upload request is invalid." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > IMAGE_CONSTRAINTS.maxFileSizeBytes) {
    return NextResponse.json({ error: "Images must be 10MB or smaller." }, { status: 400 });
  }

  const intent = await db.listingImageUploadIntent.findUnique({ where: { id: intentId.data } });
  if (!intent || intent.userId !== user.id || intent.deliveryType !== "imagekit" || intent.status !== "ISSUED") {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
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
      await deleteDisposableImageKitFile({ fileId: uploaded.fileId });
      return NextResponse.json({ error: verified.error }, { status: 400 });
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
      await deleteDisposableImageKitFile({ fileId: uploaded.fileId }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Could not upload the image.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
