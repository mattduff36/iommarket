"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { captureException } from "@/lib/monitoring";
import {
  CHECKLIST_SETTING_KEY,
  createDefaultChecklistItems,
  remainingChecklistCount,
  resolveChecklistItems,
  type ChecklistItem,
} from "@/lib/admin/checklist";
import {
  saveChecklistSchema,
  type SaveChecklistInput,
} from "@/lib/validations/admin";

export async function loadChecklist() {
  await requireRole("ADMIN");

  try {
    const row = await db.siteSetting.findUnique({
      where: { key: CHECKLIST_SETTING_KEY },
    });

    if (!row) {
      const items = createDefaultChecklistItems();
      await db.siteSetting.create({
        data: {
          key: CHECKLIST_SETTING_KEY,
          value: items as unknown as Prisma.InputJsonValue,
        },
      });
      return { data: items };
    }

    return { data: resolveChecklistItems(row.value) };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "loadChecklist",
      route: "/admin/checklist",
      requestPath: "/admin/checklist",
    });
    const message =
      err instanceof Error ? err.message : "Failed to load checklist";
    return { error: message };
  }
}

export async function saveChecklist(input: SaveChecklistInput) {
  const admin = await requireRole("ADMIN");
  const parsed = saveChecklistSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const items: ChecklistItem[] = parsed.data.items;

  try {
    await db.siteSetting.upsert({
      where: { key: CHECKLIST_SETTING_KEY },
      update: { value: items as unknown as Prisma.InputJsonValue },
      create: {
        key: CHECKLIST_SETTING_KEY,
        value: items as unknown as Prisma.InputJsonValue,
      },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "SAVE_ADMIN_CHECKLIST",
      entityType: "SiteSetting",
      entityId: CHECKLIST_SETTING_KEY,
      details: {
        total: items.length,
        remaining: remainingChecklistCount(items),
      },
    });

    revalidatePath("/admin/checklist");
    return { data: { saved: true } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "saveChecklist",
      route: "/admin/checklist",
      requestPath: "/admin/checklist",
      userId: admin.id,
    });
    const message =
      err instanceof Error ? err.message : "Failed to save checklist";
    return { error: message };
  }
}
