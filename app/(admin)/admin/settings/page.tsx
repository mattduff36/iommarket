export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  getFreeListingWindowDays,
  getFreeLaunchSlotsTotal,
} from "@/lib/config/marketplace";
import { SETTING_KEYS } from "@/lib/config/site-settings";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import { SettingsForm } from "./settings-form";
import { PricingSettingsForm } from "./pricing-settings-form";

export const metadata: Metadata = { title: "Settings | Admin" };

export default async function AdminSettingsPage() {
  const [settings, freeSlotsTotal, pricing] = await Promise.all([
    db.siteSetting.findMany({ orderBy: { key: "asc" } }),
    getFreeLaunchSlotsTotal(),
    getMarketplacePricing(),
  ]);

  const envDefaults: Record<string, string> = {
    [SETTING_KEYS.FREE_LISTING_WINDOW_DAYS]: String(getFreeListingWindowDays()),
    [SETTING_KEYS.LAUNCH_FREE_UNTIL]: process.env.LAUNCH_FREE_UNTIL ?? "(not set)",
    [SETTING_KEYS.FREE_LAUNCH_SLOTS_TOTAL]: String(freeSlotsTotal),
    [SETTING_KEYS.MONITORING_ALERT_EMAILS]:
      process.env.MONITORING_ALERT_EMAILS ??
      process.env.RESEND_REPORTS_TO_EMAIL ??
      "(not set)",
    [SETTING_KEYS.MONITORING_ALERT_WEBHOOK_URL]:
      process.env.MONITORING_ALERT_WEBHOOK_URL ?? "(not set)",
    [SETTING_KEYS.MONITORING_ALERT_MIN_SEVERITY]:
      process.env.MONITORING_ALERT_MIN_SEVERITY ?? "HIGH",
    [SETTING_KEYS.MONITORING_ALERT_COOLDOWN_MINUTES]:
      process.env.MONITORING_ALERT_COOLDOWN_MINUTES ?? "30",
  };

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Site Settings</h1>
      <p className="text-sm text-text-secondary mb-8">
        Marketplace prices are database-managed below. Other settings can override their environment or code defaults.
      </p>
      <PricingSettingsForm pricing={pricing} />
      <SettingsForm settings={settings} envDefaults={envDefaults} />
    </>
  );
}
