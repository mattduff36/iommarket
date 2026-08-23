"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
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
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/dealers");
  revalidatePath("/categories");
}

export async function enablePreviewPack(input: { dealerKey: string }) {
  await requireRole("ADMIN");
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
    const message = error instanceof Error ? error.message : "Failed to enable preview pack.";
    return { error: message };
  }
}

export async function disablePreviewPack(input: { dealerKey: string }) {
  await requireRole("ADMIN");
  const parsed = dealerKeySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid dealer key." };
  try {
    await setPreviewPackEnabled(parsed.data.dealerKey, false);
    revalidatePreviewSurfaces();
    return { data: { enabled: false } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to disable preview pack.";
    return { error: message };
  }
}
