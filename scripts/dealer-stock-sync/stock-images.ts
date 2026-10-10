import { db } from "../../lib/db";
import { uploadPreviewPackImages, enqueuePreviewUploadedImageCleanup, type PreviewUploadedImage } from "../../lib/preview-packs/upload";
import { isOwnedListingImage } from "../../lib/dealer-stock-sync/images";
import type { FingerprintSnapshot } from "../../lib/dealer-stock-sync/fingerprint";
import type { OwnedListingImage } from "../../lib/dealer-stock-sync/types";

export async function cleanupStockImages(uploaded: PreviewUploadedImage[]) {
  const attached = await db.listingImage.findMany({ where: { publicId: { in: uploaded.map(image => image.publicId) } }, select: { publicId: true } });
  const used = new Set(attached.map(image => image.publicId));
  await enqueuePreviewUploadedImageCleanup(db, uploaded.filter(image => !used.has(image.publicId)), "stock-sync-apply-failed");
}

export async function prepareStockImages(snapshot: FingerprintSnapshot, jobId: string,
  upload = uploadPreviewPackImages) {
  const uploaded: PreviewUploadedImage[] = [];
  const images: Record<string, OwnedListingImage[]> = {};
  try {
    for (const action of snapshot.actions) {
      if (action.kind !== "create") continue;
      if (!action.sourceImageUrls?.length) throw new Error("The approved report has no source photos. Run a new stock check.");
      const result = await upload({ dealerKey: snapshot.binding.registryKey, identityKey: action.sourceIdentityKey,
        attemptId: `${jobId}-${crypto.randomUUID()}`, sources: action.sourceImageUrls.slice(0, 20).map((url, order) => ({ url, order, localPath: null })),
      });
      uploaded.push(...result);
      const owned = result.map(image => ({ ...image, width: image.width ?? 0, height: image.height ?? 0 }));
      if (!owned.length || owned.some(image => !isOwnedListingImage(image))) throw new Error("No usable owned photos were imported.");
      images[action.sourceIdentityKey] = owned;
    }
    return { uploaded, images };
  } catch (error) { await cleanupStockImages(uploaded); throw error; }
}
