"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { deleteImage } from "@/lib/upload/cloudinary";

export async function listImages(input: { filter?: string; page?: number; pageSize?: number }) {
  await requireRole("ADMIN");

  const filter = input.filter;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 30));

  const where = filter === "orphan"
    ? {
        listing: {
          status: { in: ["TAKEN_DOWN" as const, "EXPIRED" as const] },
        },
      }
    : {};

  const [images, total] = await Promise.all([
    db.listingImage.findMany({
      where,
      orderBy: { listing: { createdAt: "desc" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            status: true,
            user: { select: { email: true } },
            dealer: { select: { name: true } },
          },
        },
      },
    }),
    db.listingImage.count({ where }),
  ]);

  return {
    data: { images, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function adminDeleteImage(imageId: string) {
  const admin = await requireRole("ADMIN");
  if (!imageId) return { error: "Missing imageId" };

  const image = await db.listingImage.findUnique({ where: { id: imageId } });
  if (!image) return { error: "Image not found" };

  try {
    await deleteImage(image.publicId);
  } catch {
    // Cloudinary delete may fail if image already gone; proceed with DB cleanup
  }

  try {
    await db.listingImage.delete({ where: { id: imageId } });

    await logAdminAction({
      adminId: admin.id,
      action: "DELETE_IMAGE",
      entityType: "ListingImage",
      entityId: imageId,
      details: { publicId: image.publicId, listingId: image.listingId },
    });

    revalidatePath("/admin/media");
    revalidatePath(`/listings/${image.listingId}`);
    return { data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete image";
    return { error: message };
  }
}
