"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { listingPhotoSelect } from "@/lib/images/photo";
import { canUploadAdminStockPhoto } from "@/lib/listings/admin-stock-upload";
import { syncListingImagesForUser } from "@/lib/listings/photo-mutation";
import { getSellerListingPhotoLimit } from "@/lib/listings/photo-limits";
import { syncListingImagesSchema } from "@/lib/validations/listing";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { reportHandledException } from "@/lib/monitoring";

const schema = z.object({ listingId: z.string().cuid(), input: syncListingImagesSchema }).strict();

export async function loadAdminStockDraftPhotos(listingId: string) {
  const admin = await requireRole("ADMIN");
  try {
    if (!(await canUploadAdminStockPhoto(admin, { listingId }))) return { error: "Photo editing is only available for recalled stock drafts." };
    const listing = await db.listing.findUniqueOrThrow({ where: { id: listingId }, select: {
      id: true, photoRevision: true, dealerId: true, featured: true,
      user: { select: { role: true, dealerProfile: { select: { id: true, tier: true } } } },
      images: { select: listingPhotoSelect, orderBy: { order: "asc" } },
    } });
    return { data: { images: listing.images, photoRevision: listing.photoRevision,
      maxImages: getSellerListingPhotoLimit(listing.user, listing) } };
  } catch (error) {
    await reportHandledException({ error, action: "loadAdminStockDraftPhotos", route: "/admin/stock-reviews", userId: admin.id });
    return { error: "The saved draft photos could not be loaded. Refresh before trying again." };
  }
}

export async function saveAdminStockDraftPhotos(input: unknown) {
  const admin = await requireRole("ADMIN");
  const limited = rateLimitActionError(await checkRateLimit(makeRateLimitKey("admin-stock-photos", admin.id),
    { maxRequests: 20, windowMs: 60_000, policy: "dealer-stock-sync" }), "Too many photo changes. Try again shortly.");
  if (limited) return { error: limited };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Choose valid photos and reload the editor." };
  try {
    if (!(await canUploadAdminStockPhoto(admin, { listingId: parsed.data.listingId }))) return { error: "This draft is no longer available for admin photo editing." };
    const result = await syncListingImagesForUser({ listingId: parsed.data.listingId, userId: admin.id, isAdmin: true, input: parsed.data.input });
    if (result.data) {
      for (const path of ["/admin/stock-reviews", "/admin/listings", `/listings/${parsed.data.listingId}`]) revalidatePath(path);
    }
    return result;
  } catch (error) {
    await reportHandledException({ error, action: "saveAdminStockDraftPhotos", route: "/admin/stock-reviews", userId: admin.id });
    return { error: "The photo change could not be confirmed. Refresh the draft before retrying." };
  }
}
