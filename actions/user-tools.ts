"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const toggleFavouriteSchema = z.object({
  listingId: z.string().cuid(),
});

const saveSearchSchema = z.object({
  name: z.string().min(2).max(80),
  queryParamsJson: z.record(z.string(), z.string()),
});

const deleteSavedSearchSchema = z.object({
  savedSearchId: z.string().cuid(),
});

export async function toggleFavourite(input: { listingId: string }) {
  const user = await requireAuth();
  const parsed = toggleFavouriteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const existing = await db.favourite.findUnique({
    where: {
      userId_listingId: {
        userId: user.id,
        listingId: parsed.data.listingId,
      },
    },
  });

  if (existing) {
    await db.favourite.delete({ where: { id: existing.id } });
    revalidatePath(`/listings/${parsed.data.listingId}`);
    return { data: { isFavourite: false } };
  }

  await db.favourite.create({
    data: {
      userId: user.id,
      listingId: parsed.data.listingId,
    },
  });
  revalidatePath(`/listings/${parsed.data.listingId}`);
  return { data: { isFavourite: true } };
}

export async function saveSearch(input: {
  name: string;
  queryParamsJson: Record<string, string>;
}) {
  const user = await requireAuth();
  const parsed = saveSearchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const created = await db.savedSearch.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      queryParamsJson: parsed.data.queryParamsJson,
    },
  });
  revalidatePath("/account/saved-searches");
  return { data: created };
}

export async function deleteSavedSearch(input: { savedSearchId: string }) {
  const user = await requireAuth();
  const parsed = deleteSavedSearchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const existing = await db.savedSearch.findUnique({
    where: { id: parsed.data.savedSearchId },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) return { error: "Not authorized" };

  await db.savedSearch.delete({ where: { id: parsed.data.savedSearchId } });
  revalidatePath("/account/saved-searches");
  return { data: { ok: true } };
}
