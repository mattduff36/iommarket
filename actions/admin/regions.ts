"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  createRegionSchema,
  updateRegionSchema,
  type CreateRegionInput,
  type UpdateRegionInput,
} from "@/lib/validations/admin";

export async function listRegions() {
  await requireRole("ADMIN");

  const regions = await db.region.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { users: true, listings: true } },
    },
  });

  return { data: regions };
}

export async function createRegion(input: CreateRegionInput) {
  const admin = await requireRole("ADMIN");

  const parsed = createRegionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const region = await db.region.create({ data: parsed.data });

    await logAdminAction({
      adminId: admin.id,
      action: "CREATE_REGION",
      entityType: "Region",
      entityId: region.id,
      details: { name: region.name, slug: region.slug },
    });

    revalidatePath("/admin/regions");
    return { data: region };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create region";
    return { error: message };
  }
}

export async function updateRegion(input: UpdateRegionInput) {
  const admin = await requireRole("ADMIN");

  const parsed = updateRegionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { id, ...data } = parsed.data;

  try {
    const region = await db.region.update({ where: { id }, data });

    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_REGION",
      entityType: "Region",
      entityId: id,
      details: data,
    });

    revalidatePath("/admin/regions");
    return { data: region };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update region";
    return { error: message };
  }
}

export async function toggleRegionActive(id: string, active: boolean) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };

  try {
    const region = await db.region.update({ where: { id }, data: { active } });

    await logAdminAction({
      adminId: admin.id,
      action: active ? "ENABLE_REGION" : "DISABLE_REGION",
      entityType: "Region",
      entityId: id,
    });

    revalidatePath("/admin/regions");
    return { data: region };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update region";
    return { error: message };
  }
}

export async function deleteRegion(id: string) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };

  const [userCount, listingCount] = await Promise.all([
    db.user.count({ where: { regionId: id } }),
    db.listing.count({ where: { regionId: id } }),
  ]);

  if (userCount > 0 || listingCount > 0) {
    return {
      error: `Cannot delete: region has ${userCount} user${userCount !== 1 ? "s" : ""} and ${listingCount} listing${listingCount !== 1 ? "s" : ""}. Disable it instead.`,
    };
  }

  try {
    await db.region.delete({ where: { id } });

    await logAdminAction({
      adminId: admin.id,
      action: "DELETE_REGION",
      entityType: "Region",
      entityId: id,
    });

    revalidatePath("/admin/regions");
    return { data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete region";
    return { error: message };
  }
}
