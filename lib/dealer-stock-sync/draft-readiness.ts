import type { Prisma, StockReviewDraftReceipt } from "@prisma/client";
import { ListingLifecycleError } from "@/lib/listings/errors";
import { listingDetailsSchema } from "@/lib/validations/listing";
import { validateListingAttributesWithServerPolicy } from "@/lib/listings/listing-ns-policy";
import { isTrustedListingPublicId } from "@/lib/images/cloudinary-url";
import { isManagedListingPath, managedMediaPublicId } from "@/lib/media/managed-policy";
import { STOCK_REVIEW_HELD_ERROR } from "./draft-handoff";

interface StoredPhoto {
  provider: string; publicId: string; url: string; imageKitFilePath: string | null; imageKitFileId: string | null;
}

export function isOwnedStockDraftPhoto(photo: StoredPhoto) {
  if (photo.provider === "IMAGEKIT") {
    return Boolean(photo.imageKitFileId && photo.imageKitFilePath && isManagedListingPath(photo.imageKitFilePath) &&
      managedMediaPublicId(photo.imageKitFilePath) === photo.publicId && photo.url === `imagekit-private:${photo.imageKitFilePath}`);
  }
  if (photo.provider !== "CLOUDINARY" || !isTrustedListingPublicId(photo.publicId)) return false;
  try { const url = new URL(photo.url); return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && !url.username && !url.password && !url.port; }
  catch { return false; }
}

/** Runs inside the submission transaction, after owner authorization, before status changes. */
export async function assertStockDraftReady(client: Prisma.TransactionClient, input: {
  receipt: Pick<StockReviewDraftReceipt, "id" | "listingId" | "revisionId" | "userId">;
  actorId: string | null; acknowledgementReceiptId?: string;
}) {
  const { receipt } = input;
  if (!input.actorId || receipt.userId !== input.actorId || input.acknowledgementReceiptId !== receipt.id) {
    throw new ListingLifecycleError("Review the imported draft issues and confirm that you have resolved them before submitting.");
  }
  await client.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${receipt.listingId} FOR UPDATE`;
  if (receipt.revisionId) await client.$queryRaw`SELECT "id" FROM "ListingRevision" WHERE "id" = ${receipt.revisionId} FOR UPDATE`;
  const draft = await assertStoredStockDraftReady(client, { listingId: receipt.listingId, revisionId: receipt.revisionId });
  const correctOwner = "listingId" in draft ? draft.listingId === receipt.listingId : draft.userId === input.actorId;
  if (!correctOwner) throw new ListingLifecycleError("This imported draft changed. Reload it before submitting.");
  await client.stockReviewDraftReceipt.update({ where: { id: receipt.id }, data: {
    reviewAcknowledgedAt: new Date(), acknowledgedById: input.actorId,
  } });
}

/** Admin confirmation is audited separately; it never fabricates a dealer declaration. */
export async function assertStoredStockDraftReady(client: Prisma.TransactionClient, input: {
  listingId: string; revisionId?: string | null; adminReview?: boolean;
}) {
  const include = {
    category: { include: { attributeDefinitions: true } }, region: true,
    images: true, attributeValues: true,
  };
  const draft = input.revisionId
    ? await client.listingRevision.findUnique({ where: { id: input.revisionId }, include })
    : await client.listing.findUnique({ where: { id: input.listingId }, include });
  const allowedStatus = input.revisionId ? draft?.status === "DRAFT" : ["DRAFT", "REJECTED", "TAKEN_DOWN"].includes(draft?.status ?? "");
  if (!draft || !allowedStatus) throw new ListingLifecycleError("This imported draft changed. Reload it before submitting.");
  if ("stockReviewHeld" in draft && draft.stockReviewHeld && !input.adminReview) throw new ListingLifecycleError(STOCK_REVIEW_HELD_ERROR);
  if (!draft.category.active || !draft.region.active) throw new ListingLifecycleError("Choose an active category and location before submitting.");
  const attributes = draft.attributeValues.map(value => ({ attributeDefinitionId: value.attributeDefinitionId, value: value.value }));
  const details = (input.adminReview ? listingDetailsSchema.omit({ trustDeclarationAccepted: true }) : listingDetailsSchema).safeParse({ ...draft, attributes });
  if (!details.success) throw new ListingLifecycleError(details.error.issues[0]?.message ?? "Complete the listing details before submitting.");
  const validation = validateListingAttributesWithServerPolicy({ categorySlug: draft.category.slug, definitions: draft.category.attributeDefinitions, attributes });
  const attributeError = validation.configurationError ?? Object.values(validation.fieldErrors).flat()[0];
  if (attributeError) throw new ListingLifecycleError(attributeError);
  if (draft.images.length < 2 || draft.images.some(photo => !isOwnedStockDraftPhoto(photo))) {
    throw new ListingLifecycleError("Add at least two verified listing photos before submitting this imported draft.");
  }
  return draft;
}
