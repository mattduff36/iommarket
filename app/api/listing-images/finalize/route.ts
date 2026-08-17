import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { acceptedAuthHttpStatus, requireAcceptedAuth } from "@/lib/policy/gate";
import { finalizeListingImageUploadIntent } from "@/lib/listings/photo-upload";
import { processListingImageCleanupJobs } from "@/lib/listings/photo-cleanup";
import { captureException } from "@/lib/monitoring";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";

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

  const rate = checkRateLimit(makeRateLimitKey("listing-image-finalize", user.id), {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many upload attempts. Try again shortly." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid upload data" }, { status: 400 });
  }

  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload data" }, { status: 400 });
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
      return NextResponse.json({ error: result.error ?? "Could not verify the uploaded image." }, { status: 400 });
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
    await captureException({
      source: "SERVER",
      error,
      action: "finalizeListingImageUploadIntent",
      route: "/api/listing-images/finalize",
      requestPath: "/api/listing-images/finalize",
      userId: user.id,
    });
    return NextResponse.json({ error: "Could not verify the uploaded image." }, { status: 500 });
  }
}
