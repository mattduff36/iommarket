"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invalidateSettingsCache, SETTING_KEYS } from "@/lib/config/site-settings";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";

const sampleVisibilitySchema = z.object({
  kind: z.enum(["private", "dealer"]),
  visible: z.boolean(),
});

function revalidateMarketplaceSurfaces() {
  revalidatePath("/admin/preview-packs");
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/dealers");
  revalidatePath("/categories");
}

export async function getPreviewControls() {
  await requireRole("ADMIN");
  const [packs, sampleVisibility] = await Promise.all([
    db.dealerPreviewPack.findMany({
      where: { listings: { some: {} } },
      select: {
        dealerKey: true,
        displayName: true,
        enabled: true,
        _count: { select: { listings: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    getSampleVisibility(),
  ]);
  return {
    data: {
      packs: packs.map((pack) => ({
        dealerKey: pack.dealerKey,
        displayName: pack.displayName,
        enabled: pack.enabled,
        listingCount: pack._count.listings,
      })),
      samplePrivateVisible: sampleVisibility.privateListings,
      sampleDealerVisible: sampleVisibility.dealerListings,
    },
  };
}

export async function setSampleListingVisibility(input: {
  kind: "private" | "dealer";
  visible: boolean;
}) {
  await requireRole("ADMIN");
  const parsed = sampleVisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sample visibility." };
  const key =
    parsed.data.kind === "private"
      ? SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE
      : SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE;
  await db.siteSetting.upsert({
    where: { key },
    update: { value: parsed.data.visible },
    create: { key, value: parsed.data.visible },
  });
  invalidateSettingsCache();
  revalidateMarketplaceSurfaces();
  return { data: { kind: parsed.data.kind, visible: parsed.data.visible } };
}
