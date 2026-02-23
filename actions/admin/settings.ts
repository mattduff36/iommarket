"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { invalidateSettingsCache } from "@/lib/config/site-settings";
import {
  updateSiteSettingSchema,
  type UpdateSiteSettingInput,
} from "@/lib/validations/admin";

export async function listSettings() {
  await requireRole("ADMIN");
  const settings = await db.siteSetting.findMany({ orderBy: { key: "asc" } });
  return { data: settings };
}

export async function updateSiteSetting(input: UpdateSiteSettingInput) {
  const admin = await requireRole("ADMIN");

  const parsed = updateSiteSettingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { key, value } = parsed.data;

  try {
    const setting = await db.siteSetting.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never },
    });

    invalidateSettingsCache();

    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_SITE_SETTING",
      entityType: "SiteSetting",
      entityId: key,
      details: { value },
    });

    revalidatePath("/admin/settings");
    return { data: setting };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update setting";
    return { error: message };
  }
}

export async function deleteSiteSetting(key: string) {
  const admin = await requireRole("ADMIN");
  if (!key) return { error: "Missing key" };

  try {
    await db.siteSetting.delete({ where: { key } });
    invalidateSettingsCache();

    await logAdminAction({
      adminId: admin.id,
      action: "DELETE_SITE_SETTING",
      entityType: "SiteSetting",
      entityId: key,
    });

    revalidatePath("/admin/settings");
    return { data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete setting";
    return { error: message };
  }
}
