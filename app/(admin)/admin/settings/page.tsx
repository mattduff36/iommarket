export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  getListingFeePence,
  getFeaturedFeePence,
  getFreeListingWindowDays,
} from "@/lib/config/marketplace";
import { SETTING_KEYS } from "@/lib/config/site-settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings | Admin" };

export default async function AdminSettingsPage() {
  const settings = await db.siteSetting.findMany({ orderBy: { key: "asc" } });

  const envDefaults: Record<string, string> = {
    [SETTING_KEYS.LISTING_FEE_PENCE]: String(getListingFeePence()),
    [SETTING_KEYS.FEATURED_FEE_PENCE]: String(getFeaturedFeePence()),
    [SETTING_KEYS.FREE_LISTING_WINDOW_DAYS]: String(getFreeListingWindowDays()),
    [SETTING_KEYS.LAUNCH_FREE_UNTIL]: process.env.LAUNCH_FREE_UNTIL ?? "(not set)",
  };

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Site Settings</h1>
      <p className="text-sm text-text-secondary mb-8">
        Override environment defaults from the database. Resetting removes the DB override and reverts to the env/code default.
      </p>
      <SettingsForm settings={settings} envDefaults={envDefaults} />
    </>
  );
}
