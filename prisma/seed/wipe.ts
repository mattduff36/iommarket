import type { Prisma } from "@prisma/client";
import { WIPE_DENYLIST, WIPE_ORDER } from "./constants";

type TransactionClient = Prisma.TransactionClient;

export function getWipePlan() {
  return {
    order: [...WIPE_ORDER],
    denylist: [...WIPE_DENYLIST],
  };
}

export function assertWipePlanBoundaries() {
  const denied = new Set<string>(WIPE_DENYLIST);
  for (const table of WIPE_ORDER) {
    if (denied.has(table)) {
      throw new Error(`${table} is on both the wipe allowlist and denylist.`);
    }
  }
  for (const required of [
    "WaitlistUser",
    "ContentPage",
    "SiteSetting",
    "PaymentWebhookInbox",
    "RetentionLegalHold",
    "Region",
    "Category",
    "AttributeDefinition",
  ]) {
    if (!denied.has(required)) {
      throw new Error(`${required} must remain on the wipe denylist.`);
    }
  }
}

async function deleteNonPreserved(
  tx: TransactionClient,
  preservedUserIds: string[],
  delegate: { deleteMany: (args?: object) => Promise<unknown> },
  userIdField: "userId" | "id",
) {
  if (preservedUserIds.length === 0) {
    await delegate.deleteMany({});
    return;
  }
  await delegate.deleteMany({
    where: { [userIdField]: { notIn: preservedUserIds } },
  });
}

export async function wipeMarketplace(
  tx: TransactionClient,
  preservedUserIds: string[],
) {
  assertWipePlanBoundaries();
  await tx.dealerReviewModerationEvent.deleteMany();
  await tx.dealerReview.deleteMany();
  await tx.listingStatusEvent.deleteMany();
  await tx.listingRevisionImage.deleteMany();
  await tx.listingRevisionAttributeValue.deleteMany();
  await tx.listingRevision.deleteMany();
  await tx.favourite.deleteMany();
  await tx.savedSearch.deleteMany();
  await tx.listingView.deleteMany();
  await tx.report.deleteMany();
  await tx.payment.deleteMany();
  await tx.listingImage.deleteMany();
  await tx.listingAttributeValue.deleteMany();
  await tx.freeListingClaim.deleteMany();
  await tx.listingImageUploadIntent.deleteMany();
  await tx.listingImageCleanupJob.deleteMany();
  await tx.listing.deleteMany();
  await tx.dealerCancellationRequestEvent.deleteMany();
  await tx.dealerCancellationRequest.deleteMany();
  await tx.subscriptionCharge.deleteMany();
  await tx.subscription.deleteMany();
  await deleteNonPreserved(tx, preservedUserIds, tx.policyAcceptance, "userId");
  await deleteNonPreserved(tx, preservedUserIds, tx.accountDeletionJob, "userId");
  await tx.adminAuditLog.deleteMany();
  await deleteNonPreserved(tx, preservedUserIds, tx.dealerProfile, "userId");
  await deleteNonPreserved(tx, preservedUserIds, tx.user, "id");
}
