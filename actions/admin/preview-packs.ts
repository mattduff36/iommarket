"use server";

import { journeyUnknownResult } from "@/lib/forms/journey-public-error";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import {
  materializePreviewPack,
  previewPackExists,
  setPreviewPackEnabled,
} from "@/lib/preview-packs/materialize";
import { assertPreviewDealerAllowed } from "@/lib/preview-packs/safety";
import { registryGroupKey } from "@/lib/preview-packs/archive";
import { z } from "zod";

const dealerKeySchema = z.object({
  dealerKey: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
});

function revalidatePreviewSurfaces() {
  revalidatePath("/admin/preview-packs");
  revalidatePath("/admin/dealer-onboarding");
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/dealers");
  revalidatePath("/categories");
}

export async function enablePreviewPack(input: { dealerKey: string }) {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: "Preview packs are unavailable in this environment." };
  const parsed = dealerKeySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid dealer key." };
  try {
    assertPreviewDealerAllowed({
      dealerKey: parsed.data.dealerKey,
      groupKey: registryGroupKey(parsed.data.dealerKey),
    });
    if (await previewPackExists(parsed.data.dealerKey)) {
      await setPreviewPackEnabled(parsed.data.dealerKey, true);
      revalidatePreviewSurfaces();
      return { data: { enabled: true } };
    }
    const result = await materializePreviewPack(parsed.data.dealerKey);
    revalidatePreviewSurfaces();
    return { data: result };
  } catch (error) {
    return journeyUnknownResult({
      error: error,
      action: "enablePreviewPack",
      route: "/admin",
      journey: "dealer-admin",
      kind: "write",
      message: "We couldn't confirm whether the request to enable preview pack finished. Check the administration page before trying again."
    });
  }
}

export async function disablePreviewPack(input: { dealerKey: string }) {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: "Preview packs are unavailable in this environment." };
  const parsed = dealerKeySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid dealer key." };
  try {
    await setPreviewPackEnabled(parsed.data.dealerKey, false);
    revalidatePreviewSurfaces();
    return { data: { enabled: false } };
  } catch (error) {
    return journeyUnknownResult({
      error: error,
      action: "disablePreviewPack",
      route: "/admin",
      journey: "dealer-admin",
      kind: "destructive",
      message: "We couldn't confirm whether the request to disable preview pack finished. Check the administration page before trying again."
    });
  }
}
