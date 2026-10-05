import { loadAuthorizedUploadPhoto } from "@/lib/media/authorize-upload-photo";
import { NextRequest, NextResponse } from "next/server";
import { loadAuthorizedListingPhoto, loadAuthorizedRevisionPhoto } from "@/lib/media/authorize-listing-photo";
import { listingPhotoDeliveryQuerySchema } from "@/lib/media/listing-photo-query";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
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

  const rateDenial = toRateLimitDenial(
    await checkRateLimit(makeRateLimitKey("media-delivery", clientKey(request)), {
      windowMs: 60_000,
      maxRequests: 240,
      policy: "media-delivery",
    }),
    "Too many image requests.",
  );
  if (rateDenial) {
    return NextResponse.json({ error: rateDenial.message }, { status: rateDenial.status });
  }

  const photo = parsed.data.source === "revision"
    ? await loadAuthorizedRevisionPhoto(parsed.data.imageId)
    : parsed.data.source === "upload"
      ? await loadAuthorizedUploadPhoto(parsed.data.imageId)
      : await loadAuthorizedListingPhoto(parsed.data.imageId);
  if (!photo) {
    return NextResponse.json({ error: "Image not available." }, { status: 404 });
  }

  const delivery = signedDeliveryForPhoto({
    photo,
    mode: parsed.data.mode,
    frame: parsed.data.frame,
    width: parsed.data.w,
  });
  if (delivery.kind === "unresolved") {
    const unresolved = new URL("/media-unresolved.svg", request.url);
    unresolved.searchParams.set("reason", "unmapped");
    return NextResponse.redirect(unresolved, { status: 302, headers: { "Cache-Control": "private, max-age=60" } });
  }
  return NextResponse.redirect(delivery.url, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
