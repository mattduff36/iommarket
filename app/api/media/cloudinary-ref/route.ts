import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { allowsSignedDealerLogo } from "@/lib/media/delivery-access";
import { findMigratedDealerLogo } from "@/lib/media/migrated-dealer-logos";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";
import { imageKitDeliveryRelativePath, imageKitFillTransform } from "@/lib/media/imagekit-transforms";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { toRateLimitDenial } from "@/lib/rate-limit-result";
import { dealerLogoDeliveryUrl } from "@/lib/media/dealer-logo-delivery";
import { readMediaProviderMode } from "@/lib/media/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw || raw.length > 2000) {
    return NextResponse.json({ error: "Image not available." }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Image not available." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.host !== "res.cloudinary.com" || parsed.username || parsed.password) {
    return NextResponse.json({ error: "Image not available." }, { status: 400 });
  }

  const rateDenial = toRateLimitDenial(
    await checkRateLimit(
      makeRateLimitKey(
        "media-delivery",
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
      ),
      { windowMs: 60_000, maxRequests: 240, policy: "media-delivery" },
    ),
    "Too many image requests.",
  );
  if (rateDenial) {
    return NextResponse.json({ error: rateDenial.message }, { status: rateDenial.status });
  }

  const dealer = await db.dealerProfile.findFirst({
    where: { logoUrl: raw },
    select: {
      id: true,
      isAdminPreview: true,
      user: { select: { authUserId: true, email: true, disabledAt: true, deletedAt: true } },
    },
  });
  const viewer = await getCurrentUser();
  const sampleVisibility = await getSampleVisibility();
  const publiclyVisible = dealer
    ? Boolean(await db.dealerProfile.findFirst({
        where: { AND: [{ id: dealer.id }, getPublicDealerWhere(new Date(), sampleVisibility)] },
        select: { id: true },
      }))
    : false;
  if (
    !dealer ||
    !allowsSignedDealerLogo({
      storedLogo: true,
      authUserId: dealer.user.authUserId,
      email: dealer.user.email,
      isAdminPreview: dealer.isAdminPreview,
      sampleVisibility,
      ownerDisabled: Boolean(dealer.user.disabledAt || dealer.user.deletedAt),
      publiclyVisible,
      viewerIsAdmin: viewer?.role === "ADMIN",
    })
  ) {
    return NextResponse.json({ error: "Image not available." }, { status: 404 });
  }

  if (readMediaProviderMode() === "cloudinary") {
    let deliveryUrl: string;
    try {
      deliveryUrl = dealerLogoDeliveryUrl(raw);
    } catch {
      return NextResponse.redirect(new URL("/media-unresolved.svg", request.url), 302);
    }
    return NextResponse.redirect(deliveryUrl, { status: 302, headers: { "Cache-Control": "private, max-age=60" } });
  }

  const asset = findMigratedDealerLogo(parsed.toString());
  if (!asset) {
    return NextResponse.redirect(new URL("/media-unresolved.svg", request.url), 302);
  }
  const url = signedImageKitDeliveryUrl({
    relativePath: imageKitDeliveryRelativePath(
      asset.destinationPath,
      asset.resourceType === "video" ? undefined : imageKitFillTransform({ width: 256, height: 256 }),
    ),
  });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=60" } });
}
