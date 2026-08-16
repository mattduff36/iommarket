"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  upsertContentPageSchema,
  type UpsertContentPageInput,
} from "@/lib/validations/admin";
import { reportHandledException } from "@/lib/monitoring";

export async function listContentPages() {
  await requireRole("ADMIN");
  const pages = await db.contentPage.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  return { data: pages };
}

export async function getContentPage(id: string) {
  await requireRole("ADMIN");
  const page = await db.contentPage.findUnique({ where: { id } });
  if (!page) return { error: "Page not found" };
  return { data: page };
}

export async function upsertContentPage(input: UpsertContentPageInput) {
  const admin = await requireRole("ADMIN");

  const parsed = upsertContentPageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { id, ...data } = parsed.data;
  const publishedAt = data.status === "PUBLISHED" ? new Date() : null;

  try {
    let page;
    if (id) {
      const existing = await db.contentPage.findUnique({
        where: { id },
        select: { publishedAt: true },
      });
      page = await db.contentPage.update({
        where: { id },
        data: {
          ...data,
          publishedAt:
            data.status === "PUBLISHED"
              ? existing?.publishedAt ?? new Date()
              : null,
        },
      });
    } else {
      page = await db.contentPage.create({
        data: { ...data, publishedAt },
      });
    }

    await logAdminAction({
      adminId: admin.id,
      action: id ? "UPDATE_CONTENT_PAGE" : "CREATE_CONTENT_PAGE",
      entityType: "ContentPage",
      entityId: page.id,
      details: { slug: page.slug, title: page.title, status: page.status },
    });

    revalidatePath("/admin/pages");
    revalidatePath(`/${page.slug}`);
    return { data: page };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "upsertContentPage",
      route: "/admin/pages",
    });
    const message = err instanceof Error ? err.message : "Failed to save page";
    return { error: message };
  }
}

export async function deleteContentPage(id: string) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };

  try {
    const page = await db.$transaction(async (tx) => {
      const updated = await tx.contentPage.update({
        where: { id },
        data: { deletedAt: new Date(), status: "DRAFT", publishedAt: null },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "SOFT_DELETE_CONTENT_PAGE",
          entityType: "ContentPage",
          entityId: id,
          details: { slug: updated.slug },
        },
        tx,
      );
      return updated;
    });

    revalidatePath("/admin/pages");
    return { data: { deleted: true } };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "deleteContentPage",
      route: "/admin/pages",
    });
    const message = err instanceof Error ? err.message : "Failed to delete page";
    return { error: message };
  }
}

export async function restoreContentPage(id: string) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  try {
    const page = await db.$transaction(async (tx) => {
      const restored = await tx.contentPage.update({
        where: { id },
        data: { deletedAt: null },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "RESTORE_CONTENT_PAGE",
          entityType: "ContentPage",
          entityId: id,
        },
        tx,
      );
      return restored;
    });
    revalidatePath("/admin/pages");
    return { data: page };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "restoreContentPage",
      route: "/admin/pages",
    });
    const message = err instanceof Error ? err.message : "Failed to restore page";
    return { error: message };
  }
}
