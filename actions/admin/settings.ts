"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { invalidateSettingsCache, SETTING_KEYS } from "@/lib/config/site-settings";
import {
  isMarketplacePriceSettingKey,
  MARKETPLACE_PRICING,
} from "@/lib/config/marketplace-pricing";
import { captureException } from "@/lib/monitoring";
import {
  updateSiteSettingSchema,
  updateMarketplacePricingSchema,
  type UpdateSiteSettingInput,
  type UpdateMarketplacePricingInput,
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
  if (isMarketplacePriceSettingKey(key)) {
    return { error: "Marketplace prices must be updated through the pricing form." };
  }
  if (key === SETTING_KEYS.ADMIN_CHECKLIST) {
    return { error: "Checklist items must be updated through the checklist page." };
  }

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
    await captureException({
      source: "SERVER",
      error: err,
      action: "updateSiteSetting",
      route: "/admin/settings",
      requestPath: "/admin/settings",
      userId: admin.id,
      tags: { key },
    });
    const message = err instanceof Error ? err.message : "Failed to update setting";
    return { error: message };
  }
}

export async function updateMarketplacePricing(
  input: UpdateMarketplacePricingInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = updateMarketplacePricingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const prices = parsed.data;
  const settings = [
    [MARKETPLACE_PRICING.privateListing.key, prices.privateListing],
    [MARKETPLACE_PRICING.featuredUpgrade.key, prices.featuredUpgrade],
    [MARKETPLACE_PRICING.dealerStarterMonthly.key, prices.dealerStarterMonthly],
    [MARKETPLACE_PRICING.dealerProMonthly.key, prices.dealerProMonthly],
    [MARKETPLACE_PRICING.optionalListingSupport.key, prices.optionalListingSupport],
  ] as const;

  try {
    await db.$transaction(
      settings.map(([key, value]) =>
        db.siteSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );

    invalidateSettingsCache();
    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_MARKETPLACE_PRICING",
      entityType: "SiteSetting",
      entityId: "marketplace-pricing",
      details: Object.fromEntries(settings),
    });

    for (const path of [
      "/admin/settings",
      "/",
      "/pricing",
      "/dealer/subscribe",
      "/sell/private",
      "/demo/payments",
    ]) {
      revalidatePath(path);
    }

    return { data: prices };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "updateMarketplacePricing",
      route: "/admin/settings",
      requestPath: "/admin/settings",
      userId: admin.id,
    });
    const message =
      err instanceof Error ? err.message : "Failed to update marketplace pricing";
    return { error: message };
  }
}

export async function deleteSiteSetting(key: string) {
  const admin = await requireRole("ADMIN");
  if (!key) return { error: "Missing key" };
  if (isMarketplacePriceSettingKey(key)) {
    return { error: "Marketplace prices must be updated through the pricing form." };
  }
  if (key === SETTING_KEYS.ADMIN_CHECKLIST) {
    return { error: "Checklist items must be updated through the checklist page." };
  }

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
    await captureException({
      source: "SERVER",
      error: err,
      action: "deleteSiteSetting",
      route: "/admin/settings",
      requestPath: "/admin/settings",
      userId: admin.id,
      tags: { key },
    });
    const message = err instanceof Error ? err.message : "Failed to delete setting";
    return { error: message };
  }
}
