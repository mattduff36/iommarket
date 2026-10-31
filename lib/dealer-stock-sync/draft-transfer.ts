import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { cloneLiveImagesToRevision } from "@/lib/listings/revision-photos";
import { stockReviewDraft } from "./review-edit";
import { isDraftableStockAction } from "./selection";
import { isOwnedListingImage } from "./images";
import { claimManagedImportsForAttachment } from "@/lib/media/managed-import";
import type { FingerprintSnapshot } from "./fingerprint";
import type { PlanAction } from "./types";

const VEHICLE_CATEGORIES = ["car", "van", "motorbike", "motorhome"];

async function existingListingDraft(tx: Prisma.TransactionClient, snapshot: FingerprintSnapshot, action: PlanAction) {
  const listing = await tx.listing.findUnique({ where: { id: action.listingId! }, include: { attributeValues: true } });
  if (!listing || listing.dealerId !== snapshot.dealer.id || listing.userId !== snapshot.dealer.userId ||
      listing.status !== "LIVE" || listing.soldAt || (listing.expiresAt && listing.expiresAt <= new Date())) {
    throw new Error("Only this dealer's live listings can receive draft changes.");
  }
  const open = await tx.listingRevision.findFirst({ where: { listingId: listing.id, status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } });
  if (open) throw new Error("This listing already has draft changes. Review those before sending more.");
  const changes = action.kind === "update" || action.kind === "conflict" ? action.changes : [];
  const price = changes.find(change => change.field === "price")?.after;
  const mileage = changes.find(change => change.field === "mileage")?.after;
  const mileageDefinition = mileage == null ? null : await tx.attributeDefinition.findFirst({ where: { categoryId: listing.categoryId, slug: "mileage" }, select: { id: true } });
  const attributes = listing.attributeValues.map(value => ({
    attributeDefinitionId: value.attributeDefinitionId,
    value: value.attributeDefinitionId === mileageDefinition?.id ? String(mileage) : value.value,
  }));
  if (mileageDefinition && !attributes.some(value => value.attributeDefinitionId === mileageDefinition.id)) {
    attributes.push({ attributeDefinitionId: mileageDefinition.id, value: String(mileage) });
  }
  const claimed = await tx.listing.updateMany({
    where: { id: listing.id, status: "LIVE", lifecycleRevision: listing.lifecycleRevision },
    data: { lifecycleRevision: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new Error("This listing changed. Reload the review.");
  const revision = await tx.listingRevision.create({ data: {
    listingId: listing.id, title: listing.title, description: listing.description,
    price: price ?? listing.price, categoryId: listing.categoryId, regionId: listing.regionId,
    trustDeclarationAccepted: false, trustDeclarationAcceptedAt: null, status: "DRAFT",
    attributeValues: { create: attributes },
  } });
  await cloneLiveImagesToRevision(tx, listing.id, revision.id);
  return { listingId: listing.id, revisionId: revision.id, categoryUnconfirmed: false };
}

async function newListingDraft(tx: Prisma.TransactionClient, snapshot: FingerprintSnapshot, action: PlanAction) {
  const identity = snapshot.identities.filter(item => item.sourceIdentityKey === action.sourceIdentityKey);
  if (identity.length !== 1 || identity[0].listingId || snapshot.listings.some(item => item.reviewSourceIdentity === action.sourceIdentityKey)) {
    throw new Error("This vehicle is already linked or its source identity needs administrator review.");
  }
  const source = stockReviewDraft(action);
  const categorySlug = source?.categorySlug || action.review?.categorySlug;
  const category = await tx.category.findFirst({
    where: { active: true, slug: categorySlug || { in: VEHICLE_CATEGORIES } },
    orderBy: { slug: "asc" }, include: { attributeDefinitions: { select: { id: true, slug: true } } },
  });
  const region = snapshot.dealer.regionId ? await tx.region.findFirst({ where: { id: snapshot.dealer.regionId, active: true }, select: { id: true } }) : null;
  if (!category || !region) throw new Error("Choose an active dealer location and vehicle category before sending drafts.");
  const title = source?.title ?? action.review?.displayTitle ?? action.displayTitle ?? "";
  const attributes = source?.attributes ?? {};
  const images = action.kind === "create" ? action.ownedImages ?? [] : [];
  if (images.some(image => !isOwnedListingImage(image))) throw new Error("A saved stock photo no longer has valid ownership evidence. Run a fresh stock check.");
  await claimManagedImportsForAttachment(tx, images);
  const listing = await tx.listing.create({ data: {
    userId: snapshot.dealer.userId, dealerId: snapshot.dealer.id, categoryId: category.id, regionId: region.id,
    title: title.slice(0, 120), description: source?.description ?? "", price: source?.pricePence ?? action.review?.pricePence ?? 0,
    status: "DRAFT", trustDeclarationAccepted: false, featured: false,
    reviewSourceIdentity: action.sourceIdentityKey, reviewSourceUrl: source?.sourceUrl ?? action.review?.sourceUrl ?? null,
    slug: `stock-draft-${createHash("sha256").update(`${snapshot.dealer.id}:${action.sourceIdentityKey}`).digest("hex").slice(0, 24)}`,
    attributeValues: { create: category.attributeDefinitions.filter(definition => attributes[definition.slug]).map(definition => ({
      attributeDefinitionId: definition.id, value: attributes[definition.slug],
    })) },
    ...(images.length ? { images: { create: images.map(image => ({
      publicId: image.publicId, url: image.url, provider: image.provider, order: image.order,
      width: image.width, height: image.height, assetId: image.assetId ?? null, version: image.version ?? null,
      imageKitFileId: image.imageKitFileId ?? null, imageKitFilePath: image.imageKitFilePath ?? null,
    })) } } : {}),
  } });
  const linked = await tx.dealerStockSourceIdentity.updateMany({
    where: { dealerId: snapshot.dealer.id, sourceIdentityKey: action.sourceIdentityKey!, listingId: null },
    data: { listingId: listing.id },
  });
  if (linked.count !== 1) throw new Error("This vehicle was linked elsewhere. Reload the review.");
  // Source URLs remain evidence only. Dealers must supply validated owned photos.
  return { listingId: listing.id, revisionId: null, categoryUnconfirmed: !categorySlug, needsPhotos: images.length < 2 };
}

export async function transferStockDrafts(tx: Prisma.TransactionClient, input: {
  reportId: string; fingerprint: string; snapshot: FingerprintSnapshot; actions: PlanAction[]; indexes: number[];
}) {
  const received: Array<{ listingId: string; revisionId: string | null }> = [];
  for (const index of input.indexes) {
    const action = input.actions[index];
    if (!action || !isDraftableStockAction(action)) throw new Error("One of these vehicles needs administrator review before it can become a dealer draft.");
    const actionKey = `${input.fingerprint}:${index}`;
    const prior = await tx.stockReviewDraftReceipt.findUnique({ where: { reportId_actionKey: { reportId: input.reportId, actionKey } } });
    if (prior) { received.push({ listingId: prior.listingId, revisionId: prior.revisionId }); continue; }
    const draft = action.listingId
      ? await existingListingDraft(tx, input.snapshot, action)
      : await newListingDraft(tx, input.snapshot, action);
    const blockers = [...new Set([
      ...(action.kind === "blocked" || action.kind === "conflict" ? [action.reason] : []),
      ...(action.review?.flags ?? []), ...(draft.categoryUnconfirmed ? ["confirm-vehicle-category"] : []),
      ...("needsPhotos" in draft && draft.needsPhotos ? ["supply-owned-photos"] : []),
    ])];
    await tx.stockReviewDraftReceipt.create({ data: {
      reportId: input.reportId, actionKey, listingId: draft.listingId, revisionId: draft.revisionId,
      dealerId: input.snapshot.dealer.id, userId: input.snapshot.dealer.userId,
      sourceIdentityKey: action.sourceIdentityKey, source: { action } as unknown as Prisma.InputJsonValue, blockers,
    } });
    received.push({ listingId: draft.listingId, revisionId: draft.revisionId });
  }
  return received;
}
