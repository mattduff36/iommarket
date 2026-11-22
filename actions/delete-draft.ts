"use server";

import { acceptedPublicSentence, journeyUnknownResult } from "@/lib/forms/journey-public-error";
import { asActionFailure, publicErrorBody } from "@/lib/forms/public-error";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { DeleteDraftError, deleteDraftInTransaction } from "@/lib/listings/delete-draft";

const expectedMessages = new Set([
  "This draft changed. Refresh your listings before deleting it.",
  "Use Discard in the received stock draft workflow for this listing.",
]);

const inputSchema = z.object({
  listingId: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
});

export async function deleteMyDraft(input: z.infer<typeof inputSchema>) {
  const user = await requireAcceptedAuth();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid draft deletion request." };
  try {
    await db.$transaction(
      (tx) => deleteDraftInTransaction(tx, { ...parsed.data, userId: user.id }),
      { isolationLevel: "Serializable" },
    );
    revalidatePath("/account/listings");
    revalidatePath("/dealer/listings");
    return { success: true };
  } catch (error) {
    const message = error instanceof DeleteDraftError
      ? acceptedPublicSentence(error.message, expectedMessages) : null;
    if (message) return asActionFailure(publicErrorBody({ message, code: "conflict", retryable: false }));
    return journeyUnknownResult({ error, journey: "listing-draft-deletion", action: "deleteMyDraft",
      route: "/account/listings", kind: "destructive", userId: user.id });
  }
}
