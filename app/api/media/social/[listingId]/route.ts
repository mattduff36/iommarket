import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPublicListingSellerAccess } from "@/lib/listings/dealer-visibility";
import { canViewListing } from "@/lib/listings/visibility";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { blocksSignedListingDelivery } from "@/lib/media/delivery-access";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { signedDeliveryForPhoto } from "@/lib/media/serve-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await context.params;
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      userId: true,
      dealerId: true,
      previewPackId: true,
      user: { select: { authUserId: true, email: true, disabledAt: true, deletedAt: true } },
      dealer: { select: { isAdminPreview: true } },
      previewPack: { select: { enabled: true } },
      images: { orderBy: { order: "asc" }, take: 1, select: listingPhotoSelect },
    },
  });
  if (!listing) return NextResponse.json({ error: "Listing not available." }, { status: 404 });
  const viewer = await getCurrentUser();
  const dealerAccess = await hasPublicListingSellerAccess(
    listing.dealerId,
    Boolean(listing.user.disabledAt),
    Boolean(listing.user.deletedAt),
  );
  const sampleVisibility = await getSampleVisibility();
  if (
    blocksSignedListingDelivery({
      listingId: listing.id,
      authUserId: listing.user.authUserId,
      dealerId: listing.dealerId,
      isAdminPreview: listing.dealer?.isAdminPreview === true,
      sampleVisibility,
      status: listing.status,
      previewPackId: listing.previewPackId,
      ownerEmail: listing.user.email,
      canView: canViewListing({
        dealerAccess,
        status: listing.status,
        expiresAt: listing.expiresAt,
        listingUserId: listing.userId,
        viewer,
        previewPackEnabled: listing.previewPack?.enabled ?? false,
        previewPackId: listing.previewPackId,
        dealerIsAdminPreview: listing.dealer?.isAdminPreview === true,
        ownerAuthUserId: listing.user.authUserId,
        ownerEmail: listing.user.email,
      }),
    })
  ) {
    return NextResponse.json({ error: "Listing not available." }, { status: 404 });
  }
  const photo = toListingPhotoSource(listing.images[0]);
  if (!photo) return NextResponse.redirect(new URL("/og/itrader-social.png", _request.url), 302);
  const delivery = signedDeliveryForPhoto({
    photo,
    mode: "social",
    frame: "social",
    width: 1200,
  });
  if (delivery.kind === "unresolved") {
    return NextResponse.redirect(new URL("/media-unresolved.svg", _request.url), 302);
  }
  return NextResponse.redirect(delivery.url, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
