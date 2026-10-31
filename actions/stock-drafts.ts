"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { discardReceivedStockDraftInTransaction, StockDraftDiscardError } from "@/lib/dealer-stock-sync/discard-draft";

const schema = z.object({ receiptId: z.string().min(1).max(100), expectedLifecycleRevision: z.number().int().nonnegative() }).strict();

export async function discardReceivedStockDraft(input: unknown) {
  const user = await requireAcceptedAuth();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Refresh the draft before deleting it." };
  const limited = await checkRateLimit(`discard-stock-draft:${user.id}`, { windowMs: 60_000, maxRequests: 20 });
  if (!limited.allowed) return { error: "Too many draft changes. Try again shortly." };
  try {
    const data = await db.$transaction(tx => discardReceivedStockDraftInTransaction(tx, { ...parsed.data, userId: user.id }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    for (const path of ["/account/listings", "/dealer/listings", "/dealer/dashboard", "/admin/stock-reviews", `/sell/dealer?draft=${data.listingId}`]) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: error instanceof StockDraftDiscardError ? error.message : "This draft could not be deleted. Refresh and try again." };
  }
}
