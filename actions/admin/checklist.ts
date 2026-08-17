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
  normalizeChecklistLabels,
  parseStoredChecklistItems,
  remainingChecklistCount,
  type ChecklistItem,
} from "@/lib/admin/checklist";
import {
  saveChecklistSchema,
  updateChecklistCompletionSchema,
  type SaveChecklistInput,
  type UpdateChecklistCompletionInput,
} from "@/lib/validations/admin";

const CHECKLIST_CONFLICT_ERROR =
  "The checklist changed in another session. Refresh and try again.";
const CHECKLIST_MALFORMED_ERROR =
  "The stored checklist is malformed. No entries were loaded or saved.";

export async function loadChecklist() {
  await requireRole("ADMIN");

  try {
    const row = await db.siteSetting.findUnique({
      where: { key: CHECKLIST_SETTING_KEY },
    });

    if (!row) {
      const items = createDefaultChecklistItems();
      const created = await db.siteSetting.create({
        data: {
          key: CHECKLIST_SETTING_KEY,
          value: items as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        data: { items, updatedAt: created.updatedAt.toISOString() },
      };
    }

    const parsed = parseStoredChecklistItems(row.value);
    if (!parsed.success) {
      return { error: CHECKLIST_MALFORMED_ERROR };
    }
    return {
      data: { items: parsed.items, updatedAt: row.updatedAt.toISOString() },
    };
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

  const items: ChecklistItem[] = parsed.data.items.map((item) => ({
    ...item,
    labels: normalizeChecklistLabels(item.labels),
  }));
  const outgoing = parseStoredChecklistItems(items);
  if (!outgoing.success) return { error: outgoing.error };
  const validatedItems = outgoing.items;

  try {
    const snapshot = await db.$transaction(async (tx) => {
      const current = await tx.siteSetting.findUnique({
        where: { key: CHECKLIST_SETTING_KEY },
      });
      if (!current) throw new Error(CHECKLIST_CONFLICT_ERROR);
      if (!parseStoredChecklistItems(current.value).success) {
        throw new Error(CHECKLIST_MALFORMED_ERROR);
      }

      const updated = await tx.siteSetting.updateMany({
        where: {
          key: CHECKLIST_SETTING_KEY,
          updatedAt: new Date(parsed.data.expectedUpdatedAt),
        },
        data: { value: validatedItems as unknown as Prisma.InputJsonValue },
      });
      if (updated.count !== 1) throw new Error(CHECKLIST_CONFLICT_ERROR);

      return tx.siteSetting.findUniqueOrThrow({
        where: { key: CHECKLIST_SETTING_KEY },
      });
    });

    await logAdminAction({
      adminId: admin.id,
      action: "SAVE_ADMIN_CHECKLIST",
      entityType: "SiteSetting",
      entityId: CHECKLIST_SETTING_KEY,
      details: {
        total: validatedItems.length,
        remaining: remainingChecklistCount(validatedItems),
      },
    });

    revalidatePath("/admin/checklist");
    return {
      data: {
        saved: true,
        items: validatedItems,
        updatedAt: snapshot.updatedAt.toISOString(),
      },
    };
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

export async function updateChecklistCompletion(
  input: UpdateChecklistCompletionInput,
) {
  const admin = await requireRole("ADMIN");
  const parsed = updateChecklistCompletionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const snapshot = await db.$transaction(async (tx) => {
      const current = await tx.siteSetting.findUnique({
        where: { key: CHECKLIST_SETTING_KEY },
      });
      if (!current) throw new Error(CHECKLIST_CONFLICT_ERROR);

      const stored = parseStoredChecklistItems(current.value);
      if (!stored.success) throw new Error(CHECKLIST_MALFORMED_ERROR);

      const item = stored.items.find(
        (entry) => entry.id === parsed.data.itemId,
      );
      if (!item || item.updatedAt !== parsed.data.expectedItemUpdatedAt) {
        throw new Error(CHECKLIST_CONFLICT_ERROR);
      }

      const nextItems = stored.items.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              done: parsed.data.done,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      );
      const outgoing = parseStoredChecklistItems(nextItems);
      if (!outgoing.success) throw new Error(outgoing.error);
      const updated = await tx.siteSetting.updateMany({
        where: {
          key: CHECKLIST_SETTING_KEY,
          updatedAt: new Date(parsed.data.expectedUpdatedAt),
        },
        data: { value: outgoing.items as unknown as Prisma.InputJsonValue },
      });
      if (updated.count !== 1) throw new Error(CHECKLIST_CONFLICT_ERROR);

      const row = await tx.siteSetting.findUniqueOrThrow({
        where: { key: CHECKLIST_SETTING_KEY },
      });
      return { items: outgoing.items, updatedAt: row.updatedAt.toISOString() };
    });

    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_ADMIN_CHECKLIST_COMPLETION",
      entityType: "SiteSetting",
      entityId: CHECKLIST_SETTING_KEY,
      details: {
        itemId: parsed.data.itemId,
        done: parsed.data.done,
      },
    });
    revalidatePath("/admin/checklist");
    return { data: snapshot };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "updateChecklistCompletion",
      route: "/admin/checklist",
      requestPath: "/admin/checklist",
      userId: admin.id,
    });
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to update checklist completion",
    };
  }
}
