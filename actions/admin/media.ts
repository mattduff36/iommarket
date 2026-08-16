"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { reportHandledException } from "@/lib/monitoring";

const ORDER_SHIFT = 10_000;

export async function listImages(input: { filter?: string; page?: number; pageSize?: number }) {
  await requireRole("ADMIN");

  const filter = input.filter;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 30));

  const where: Prisma.ListingImageWhereInput = filter === "orphan"
    ? {
        listing: {
          status: { in: ["TAKEN_DOWN", "EXPIRED"] },
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

  try {
    const image = await db.$transaction(async (tx) => {
      const current = await tx.listingImage.findUnique({
        where: { id: imageId },
        select: {
          id: true,
          listingId: true,
          publicId: true,
          provider: true,
        },
      });
      if (!current) {
        throw new Error("Image not found");
      }

      const locked = await tx.listing.updateMany({
        where: { id: current.listingId, status: { notIn: ["LIVE", "SOLD"] } },
        data: { photoRevision: { increment: 1 } },
      });
      if (locked.count !== 1) {
        throw new Error("Take the listing down before deleting images from a live or sold listing.");
      }

      await tx.listingImage.delete({ where: { id: imageId } });

      const remaining = await tx.listingImage.findMany({
        where: { listingId: current.listingId },
        orderBy: { order: "asc" },
      });
      if (remaining.length > 0) {
        await Promise.all(
          remaining.map((item) =>
            tx.listingImage.update({
              where: { id: item.id },
              data: { order: item.order + ORDER_SHIFT },
            }),
          ),
        );
        await Promise.all(
          remaining.map((item, order) =>
            tx.listingImage.update({
              where: { id: item.id },
              data: { order },
            }),
          ),
        );
      }

      if (
        current.provider === "CLOUDINARY" &&
        current.publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/`)
      ) {
        await tx.listingImageCleanupJob.create({
          data: {
            publicId: current.publicId,
            deliveryType: IMAGE_CONSTRAINTS.deliveryType,
            reason: "admin-deleted",
          },
        });
      }

      return current;
    });

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
    await reportHandledException({
      error: err,
      action: "deleteListingImage",
      route: "/admin/media",
    });
    const message = err instanceof Error ? err.message : "Failed to delete image";
    return { error: message };
  }
}
