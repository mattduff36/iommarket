"use server";

import { journeyUnknownResult } from "@/lib/forms/journey-public-error";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { liveListingWhere } from "@/lib/listings/expiry";
import {
  createRegionSchema,
  updateRegionSchema,
  type CreateRegionInput,
  type UpdateRegionInput,
} from "@/lib/validations/admin";
import { reportHandledException } from "@/lib/monitoring";
import {
  applySampleListingVisibility,
  applySampleUserVisibility,
  getSampleVisibility,
} from "@/lib/listings/sample-visibility";

export async function listRegions() {
  await requireRole("ADMIN");
  const sampleVisibility = await getSampleVisibility();

  const regions = await db.region.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          users: { where: applySampleUserVisibility({}, sampleVisibility) },
          listings: {
            where: applySampleListingVisibility({}, sampleVisibility),
          },
        },
      },
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

    return journeyUnknownResult({
      error: err,
      action: "createRegion",
      route: "/admin/regions",
      journey: "dealer-admin",
      kind: "write",
      message: "We couldn't confirm whether the request to create region finished. Check the administration page before trying again."
    });
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

    return journeyUnknownResult({
      error: err,
      action: "updateRegion",
      route: "/admin/regions",
      journey: "dealer-admin",
      kind: "write",
      message: "We couldn't confirm whether the request to update region finished. Check the administration page before trying again."
    });
  }
}

export async function toggleRegionActive(id: string, active: boolean) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };

  try {
    const sampleVisibility = await getSampleVisibility();
    const liveListingCount = await db.listing.count({
      where: applySampleListingVisibility(
        { regionId: id, ...liveListingWhere() },
        sampleVisibility,
      ),
    });
    const region = await db.region.update({ where: { id }, data: { active } });

    await logAdminAction({
      adminId: admin.id,
      action: active ? "ENABLE_REGION" : "DISABLE_REGION",
      entityType: "Region",
      entityId: id,
      details: { liveListingCount },
    });

    revalidatePath("/admin/regions");
    return { data: region };
  } catch (err) {

    return journeyUnknownResult({
      error: err,
      action: "toggleRegionActive",
      route: "/admin/regions",
      journey: "dealer-admin",
      kind: "write",
      message: "We couldn't confirm whether the request to update region finished. Check the administration page before trying again."
    });
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
      error:
        "Cannot delete: region is referenced by existing users or listings. Disable it instead.",
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

    return journeyUnknownResult({
      error: err,
      action: "deleteRegion",
      route: "/admin/regions",
      journey: "dealer-admin",
      kind: "destructive",
      message: "We couldn't confirm whether the request to delete region finished. Check the administration page before trying again."
    });
  }
}
