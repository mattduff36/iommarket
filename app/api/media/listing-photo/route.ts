import { loadAuthorizedUploadPhoto } from "@/lib/media/authorize-upload-photo";
import { NextRequest, NextResponse } from "next/server";
import { loadListingPhotoAccess, loadAuthorizedRevisionPhoto } from "@/lib/media/authorize-listing-photo";
import { listingPhotoDeliveryQuerySchema } from "@/lib/media/listing-photo-query";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";
import { checkMediaReadRateLimit } from "@/lib/media/read-rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
import { reportMediaDenial } from "@/lib/media/request-diagnostics";
import { MEDIA_RATE_LIMIT_TIMING } from "@/lib/media/denial-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

async function limitProtectedRead(request: NextRequest) {
  const rateResult = await checkMediaReadRateLimit(clientKey(request));
  const rateDenial = toRateLimitDenial(
    rateResult,
    "Too many image requests.",
  );
  if (rateDenial) {
    if (rateDenial.status === 429) reportMediaDenial({
      path: request.nextUrl.pathname + request.nextUrl.search, denialSource: rateResult.denialSource,
      retryAfterSeconds: rateDenial.retryAfterSeconds,
      requestId: request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id"), release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
    const headers = new Headers({ "Retry-After": String(rateDenial.retryAfterSeconds), "Cache-Control": "no-store" });
    if (rateDenial.status === 429 && rateResult.denialSource) {
      headers.set("Server-Timing", `${MEDIA_RATE_LIMIT_TIMING};desc="${rateResult.denialSource}"`);
    }
    return NextResponse.json({ error: rateDenial.message }, { status: rateDenial.status, headers });
  }
  return null;
}

function photoUnavailable() {
  return NextResponse.json({ error: "Image not available." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const parsed = listingPhotoDeliveryQuerySchema.safeParse({
    imageId: request.nextUrl.searchParams.get("imageId"),
    source: request.nextUrl.searchParams.get("source") ?? undefined,
    mode: request.nextUrl.searchParams.get("mode"),
    frame: request.nextUrl.searchParams.get("frame"),
    w: request.nextUrl.searchParams.get("w"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid image request." }, { status: 400 });
  }

  const { imageId, source, mode, frame, w } = parsed.data;
  const access = source === "listing" ? await loadListingPhotoAccess(imageId) : null;
  if (!access?.isPublic) {
    const denial = await limitProtectedRead(request);
    if (denial) return denial;
  }
  const photo = access?.isPublic ? access.photo
    : source === "revision" ? await loadAuthorizedRevisionPhoto(imageId)
    : source === "upload" ? await loadAuthorizedUploadPhoto(imageId)
    : await access?.authorize();
  if (!photo) {
    return photoUnavailable();
  }

  const delivery = signedDeliveryForPhoto({
    photo, mode, frame, width: w, reusePublicRendition: access?.isPublic,
  });
  if (delivery.kind === "unresolved") return photoUnavailable();
  return NextResponse.redirect(delivery.url, {
    status: 302,
    // The CDN may reuse the rendition, but every new authorization must check
    // moderation, visibility and seller access against the current listing.
    headers: { "Cache-Control": access?.isPublic ? "private, no-cache" : "private, max-age=60" },
  });
}
