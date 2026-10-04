import type { Prisma } from "@prisma/client";
import { deleteDisposableImageKitFile } from "@/lib/media/disposable-media";
import { isDisposableDestinationPath, isProtectedDestinationPath } from "@/lib/media/config";
import { deleteImage } from "@/lib/upload/cloudinary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isPreviewSystemAuthUserId } from "@/lib/preview-packs/safety";
import { isDatabaseSyncReference } from "@/lib/images/database-sync-reference";

export class PurgeUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeUserError";
  }
}

type PurgeClient = Prisma.TransactionClient;

const ACCOUNT_TABLES = [
  "DealerPromotionCampaign",
  "DealerOnboardingInvite",
  "DealerOnboardingInviteEvent",
  "DealerUpgradeOffer",
  "DealerUpgradeAcceptance",
  "DealerCancellationRequest",
  "DealerCancellationRequestEvent",
  "DealerReviewResponse",
  "PolicyAcceptance",
  "AccountDeletionJob",
  "Payment",
  "Report",
  "Listing",
  "MonitoringEvent",
  "MonitoringIssue",
  "MonitoringAlertDelivery",
  "PaymentWebhookInbox",
  "AdminAuditLog",
  "WaitlistUser",
  "WaitlistEarlyAccessRecipient",
] as const;

export async function loadPublicTables(client: {
  $queryRaw: PurgeClient["$queryRaw"];
}) {
  const rows = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  return new Set(rows.map((row) => row.table_name));
}

function tableExists(tables: Set<string>, table: string) {
  return tables.has(table);
}

export interface PurgedUserAccount {
  email: string;
  authUserId: string | null;
  listingIds: string[];
  imagePublicIds: string[];
  imageKitDisposables: Array<{ fileId: string; filePath: string }>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloudinaryPublicIdFromUrl(url: string | null | undefined) {
  if (!url || isDatabaseSyncReference(url)) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("res.cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.findIndex((part) => part === "upload" || part === "private");
    if (uploadIndex < 0) return null;
    const rest = parts.slice(uploadIndex + 1).filter((part) => !/^v\d+$/.test(part));
    const publicId = rest.join("/").replace(/\.[a-zA-Z0-9]+$/, "");
    return publicId || null;
  } catch {
    return null;
  }
}

export async function assertUserCanBePurged(
  tx: PurgeClient,
  userId: string,
  tables: Set<string> = new Set(ACCOUNT_TABLES),
) {
  const [campaigns, foreignInvites, foreignOffers, foreignCancellations] =
    await Promise.all([
      tableExists(tables, "DealerPromotionCampaign")
        ? tx.dealerPromotionCampaign.count({ where: { createdByAdminId: userId } })
        : 0,
      tableExists(tables, "DealerOnboardingInvite")
        ? tx.dealerOnboardingInvite.count({
            where: { createdByAdminId: userId, NOT: { userId } },
          })
        : 0,
      tableExists(tables, "DealerUpgradeOffer")
        ? tx.dealerUpgradeOffer.count({
            where: {
              NOT: { userId },
              OR: [{ createdByAdminId: userId }, { cancelledByAdminId: userId }],
            },
          })
        : 0,
      tableExists(tables, "DealerCancellationRequest")
        ? tx.dealerCancellationRequest.count({
            where: {
              processedByAdminId: userId,
              NOT: { requestedByUserId: userId },
            },
          })
        : 0,
    ]);

  if (campaigns + foreignInvites + foreignOffers + foreignCancellations > 0) {
    throw new PurgeUserError(
      "This account is still referenced by other admin records and cannot be deleted.",
    );
  }
  // Also verifies the database supports the narrowly scoped immutable-record
  // exception before the caller removes the external login. Scope ends at commit.
  const [capability] = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT to_regprocedure('public.prepare_account_purge(text)') IS NOT NULL AS ready
  `;
  if (!capability?.ready) {
    throw new PurgeUserError(
      "Account deletion requires a database update. No login or profile has been removed.",
    );
  }
  await tx.$executeRaw`SELECT public.prepare_account_purge(${userId}::text)`;
}

export async function deleteEmailResidues(
  tx: PurgeClient,
  email: string,
  userId?: string,
  tables: Set<string> = new Set(ACCOUNT_TABLES),
) {
  const pattern = escapeRegExp(email);
  if (tableExists(tables, "WaitlistEarlyAccessRecipient")) {
    await tx.waitlistEarlyAccessRecipient.deleteMany({
      where: {
        OR: [
          ...(userId ? [{ testAdminUserId: userId }] : []),
          { waitlistUser: { email: { equals: email, mode: "insensitive" } } },
        ],
      },
    });
  }
  if (tableExists(tables, "MonitoringEvent")) {
    await tx.monitoringEvent.deleteMany({
      where: {
        OR: [
          ...(userId ? [{ userId }] : []),
          { userEmail: { equals: email, mode: "insensitive" } },
        ],
      },
    });
    await tx.$executeRaw`
      DELETE FROM "MonitoringEvent"
      WHERE position(lower(${email}) in lower(coalesce("message", ''))) > 0
         OR position(lower(${email}) in lower(coalesce("stack", ''))) > 0
         OR position(lower(${email}) in lower(coalesce("extra"::text, ''))) > 0
         OR position(lower(${email}) in lower(coalesce("tags"::text, ''))) > 0
    `;
  }
  if (tableExists(tables, "MonitoringIssue")) {
    await tx.$executeRaw`
      UPDATE "MonitoringIssue"
      SET "sampleMessage" = regexp_replace("sampleMessage", ${pattern}, '[deleted]', 'gi'),
          "lastGeneratedPrompt" = CASE
            WHEN "lastGeneratedPrompt" IS NULL THEN NULL
            ELSE regexp_replace("lastGeneratedPrompt", ${pattern}, '[deleted]', 'gi')
          END
      WHERE position(lower(${email}) in lower("sampleMessage")) > 0
         OR position(lower(${email}) in lower(coalesce("lastGeneratedPrompt", ''))) > 0
    `;
  }
  if (tableExists(tables, "MonitoringAlertDelivery")) {
    await tx.$executeRaw`
      UPDATE "MonitoringAlertDelivery"
      SET payload = NULL,
          "lastError" = '[deleted]',
          target = '[deleted]'
      WHERE position(lower(${email}) in lower(coalesce(payload::text, ''))) > 0
         OR position(lower(${email}) in lower(coalesce("lastError", ''))) > 0
         OR position(lower(${email}) in lower(target)) > 0
    `;
  }
  if (tableExists(tables, "PaymentWebhookInbox")) {
    await tx.paymentWebhookInbox.deleteMany({
      where: { customerEmailNorm: { equals: email, mode: "insensitive" } },
    });
    await tx.$executeRaw`
      DELETE FROM "PaymentWebhookInbox"
      WHERE position(lower(${email}) in lower("minimizedPayload"::text)) > 0
    `;
  }
  if (tableExists(tables, "AdminAuditLog")) {
    await tx.$executeRaw`
      UPDATE "AdminAuditLog"
      SET details = regexp_replace(details::text, ${pattern}, '[deleted]', 'gi')::jsonb
      WHERE details IS NOT NULL
        AND position(lower(${email}) in lower(details::text)) > 0
    `;
  }
  if (tableExists(tables, "WaitlistUser")) {
    await tx.waitlistUser.deleteMany({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }
}

async function deleteOwnedCommerce(
  tx: PurgeClient,
  userId: string,
  dealerId: string | null,
  email: string,
  tables: Set<string>,
) {
  if (!tableExists(tables, "DealerOnboardingInvite")) {
    await deleteCancellationsAndOffers(tx, userId, dealerId, tables);
    return;
  }
  const invites = await tx.dealerOnboardingInvite.findMany({
    where: {
      OR: [
        { userId },
        ...(dealerId ? [{ dealerId }] : []),
        { originalEmail: { equals: email, mode: "insensitive" as const } },
        { recipientEmailNorm: email.toLowerCase() },
      ],
    },
    select: { id: true },
  });
  const inviteIds = invites.map((invite) => invite.id);
  if (tableExists(tables, "DealerOnboardingInviteEvent")) {
    await tx.dealerOnboardingInviteEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: userId },
          ...(inviteIds.length > 0 ? [{ inviteId: { in: inviteIds } }] : []),
        ],
      },
    });
  }
  if (inviteIds.length > 0) {
    await tx.dealerOnboardingInvite.deleteMany({ where: { id: { in: inviteIds } } });
  }

  await deleteCancellationsAndOffers(tx, userId, dealerId, tables);
}

async function deleteCancellationsAndOffers(
  tx: PurgeClient,
  userId: string,
  dealerId: string | null,
  tables: Set<string>,
) {
  if (!tableExists(tables, "DealerCancellationRequest")) {
    await deleteUpgradeRecords(tx, userId, tables);
    return;
  }
  const cancellations = await tx.dealerCancellationRequest.findMany({
    where: {
      OR: [{ requestedByUserId: userId }, ...(dealerId ? [{ dealerId }] : [])],
    },
    select: { id: true },
  });
  const cancellationIds = cancellations.map((request) => request.id);
  if (tableExists(tables, "DealerCancellationRequestEvent")) {
    await tx.dealerCancellationRequestEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: userId },
          ...(cancellationIds.length > 0 ? [{ requestId: { in: cancellationIds } }] : []),
        ],
      },
    });
  }
  if (cancellationIds.length > 0) {
    await tx.dealerCancellationRequest.deleteMany({
      where: { id: { in: cancellationIds } },
    });
  }
  await deleteUpgradeRecords(tx, userId, tables);
}

async function deleteUpgradeRecords(
  tx: PurgeClient,
  userId: string,
  tables: Set<string>,
) {
  if (tableExists(tables, "DealerUpgradeAcceptance")) {
    await tx.dealerUpgradeAcceptance.deleteMany({ where: { userId } });
  }
  if (tableExists(tables, "DealerUpgradeOffer")) {
    await tx.dealerUpgradeOffer.deleteMany({ where: { userId } });
  }
}

export async function purgeUserAccountRecords(
  tx: PurgeClient,
  userId: string,
  tables: Set<string> = new Set(ACCOUNT_TABLES),
): Promise<PurgedUserAccount> {
  await assertUserCanBePurged(tx, userId, tables);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      authUserId: true,
      avatarUrl: true,
      dealerProfile: { select: { id: true, logoUrl: true } },
      listings: { select: { id: true, images: { select: { publicId: true, imageKitFileId: true, imageKitFilePath: true } } } },
      listingImageUploadIntents: { select: { publicId: true, imageKitFileId: true, imageKitFilePath: true } },
    },
  });
  if (!user) throw new PurgeUserError("User not found");

  const dealerId = user.dealerProfile?.id ?? null;
  const dealerListings = dealerId
    ? await tx.listing.findMany({
        where: { dealerId, NOT: { userId } },
        select: { id: true, images: { select: { publicId: true, imageKitFileId: true, imageKitFilePath: true } } },
      })
    : [];
  const listings = [...user.listings, ...dealerListings];
  const listingIds = listings.map((listing) => listing.id);
  const imageKitDisposables: Array<{ fileId: string; filePath: string }> = [];
  const imagePublicIds = [
    ...listings.flatMap((listing) => listing.images),
    ...user.listingImageUploadIntents,
  ].flatMap((image) => {
    if (
      image.publicId.startsWith("imagekit-dev/") &&
      image.imageKitFileId &&
      image.imageKitFilePath &&
      isDisposableDestinationPath(image.imageKitFilePath) &&
      !isProtectedDestinationPath(image.imageKitFilePath)
    ) {
      imageKitDisposables.push({ fileId: image.imageKitFileId, filePath: image.imageKitFilePath });
      return [];
    }
    return [image.publicId];
  }).concat([
    cloudinaryPublicIdFromUrl(user.avatarUrl),
    cloudinaryPublicIdFromUrl(user.dealerProfile?.logoUrl),
  ].filter((publicId): publicId is string => Boolean(publicId)));

  await deleteOwnedCommerce(tx, userId, dealerId, user.email, tables);
  if (dealerId && tableExists(tables, "DealerReviewResponse")) {
    await tx.dealerReviewResponse.updateMany({
      where: { review: { dealerId } },
      data: { approvedRevisionId: null },
    });
  }
  if (tableExists(tables, "PolicyAcceptance")) {
    await tx.policyAcceptance.deleteMany({ where: { userId } });
  }
  if (tableExists(tables, "AccountDeletionJob")) {
    await tx.accountDeletionJob.deleteMany({ where: { userId } });
  }
  if (listingIds.length > 0) {
    if (tableExists(tables, "Payment")) {
      await tx.payment.deleteMany({ where: { listingId: { in: listingIds } } });
    }
    if (tableExists(tables, "Report")) {
      await tx.report.deleteMany({ where: { listingId: { in: listingIds } } });
    }
    await tx.listing.deleteMany({ where: { id: { in: listingIds } } });
  }
  await deleteEmailResidues(tx, user.email, userId, tables);
  await tx.user.delete({ where: { id: userId } });

  return {
    email: user.email,
    authUserId: user.authUserId,
    listingIds,
    imagePublicIds,
    imageKitDisposables,
  };
}

export async function deleteAuthUser(authUserId: string | null) {
  if (
    !authUserId ||
    authUserId.startsWith("deleted:") ||
    authUserId.startsWith("database-sync:") ||
    isPreviewSystemAuthUserId(authUserId)
  ) {
    return;
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(authUserId);
  if (error && !/not found|user not found/i.test(error.message)) {
    throw new PurgeUserError(
      "The login could not be removed, so the account was left unchanged.",
    );
  }
}

export async function deleteAccountMedia(
  publicIds: string[],
  disposables: Array<{ fileId: string; filePath: string }> = [],
) {
  const failedPublicIds: string[] = [];
  for (const publicId of new Set(publicIds)) {
    if (publicId.startsWith("imagekit-dev/")) continue;
    try {
      await deleteImage(publicId);
    } catch {
      // The profile row is already gone. A leftover image should not restore the account.
      failedPublicIds.push(publicId);
    }
  }
  for (const target of disposables) {
    if (!isDisposableDestinationPath(target.filePath) || isProtectedDestinationPath(target.filePath)) {
      failedPublicIds.push(target.fileId);
      continue;
    }
    try {
      await deleteDisposableImageKitFile({
        fileId: target.fileId,
        filePath: target.filePath,
        allowlist: [target],
      });
    } catch {
      failedPublicIds.push(target.fileId);
    }
  }
  return {
    attemptedPublicIds: [...new Set(publicIds)],
    failedPublicIds,
  };
}
