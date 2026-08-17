import { revalidatePath } from "next/cache";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";
import { expireAbandonedListingImageIntents, processListingImageCleanupJobs } from "@/lib/listings/photo-cleanup";
import {
  syncListingImagesForUser,
  type ListingPhotoMutationItem,
  type SyncListingImagesInput,
} from "@/lib/listings/photo-mutation";
import { syncListingImagesActionSchema } from "@/lib/validations/listing";

function hasUnexpectedPhotoSyncContractDrift(
  issues: Array<{ code: string }>,
) {
  return issues.some(
    (issue) => issue.code === "invalid_type" || issue.code === "unrecognized_keys",
  );
}

export async function runSyncListingImagesAction(
  user: { id: string; email: string; role: string },
  listingId: string,
  input: SyncListingImagesInput,
) {
  const parsed = syncListingImagesActionSchema.safeParse({ listingId, input });
  if (!parsed.success) {
    if (hasUnexpectedPhotoSyncContractDrift(parsed.error.issues)) {
      await captureBusinessEvent({
        source: "BUSINESS",
        severity: "LOW",
        title: "Listing photo client contract drift",
        message: "The listing photo action received a payload that does not match its schema.",
        action: "syncListingImages",
        route: "/account/listings",
        requestPath: "/account/listings",
        userId: user.id,
        userEmail: user.email,
        tags: {
          issueCodes: [...new Set(parsed.error.issues.map((issue) => issue.code))].join(","),
          issueCount: parsed.error.issues.length,
        },
      });
    }
    return { error: "Invalid photo update." };
  }
  const validated = parsed.data;

  try {
    const result = await syncListingImagesForUser({
      listingId: validated.listingId,
      userId: user.id,
      isAdmin: user.role === "ADMIN",
      input: validated.input,
    });
    if (result.error) return result;

    try {
      await expireAbandonedListingImageIntents();
      await processListingImageCleanupJobs();
    } catch (cleanupError) {
      await captureException({
        source: "SERVER",
        error: cleanupError,
        action: "syncListingImagesCleanup",
        route: `/listings/${validated.listingId}`,
        requestPath: `/listings/${validated.listingId}`,
        userId: user.id,
        userEmail: user.email,
        tags: { listingId: validated.listingId },
      });
    }

    revalidatePath(`/listings/${validated.listingId}`);
    revalidatePath("/account/listings");
    revalidatePath("/dealer/dashboard");
    return result;
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "syncListingImages",
      route: `/listings/${validated.listingId}`,
      requestPath: `/listings/${validated.listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId: validated.listingId, imageCount: validated.input.photos.length },
    });
    const message = err instanceof Error ? err.message : "Failed to update images";
    return { error: message };
  }
}

export async function runSaveListingImagesAction(
  user: { id: string; email: string; role: string },
  listingId: string,
  photos: ListingPhotoMutationItem[],
  input: Omit<SyncListingImagesInput, "photos">,
) {
  return runSyncListingImagesAction(user, listingId, { ...input, photos });
}
